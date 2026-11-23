/**
 * Skill cache: disposable plaintext runtime copies of encrypted skill
 * bundles, executed through the bash connector's approval gate.
 *
 * Derivative of ProtonLumo/lumo-desktop src-tauri/src/skills.rs (GPL-3.0,
 * © Proton / ProtonLumo contributors), ported to TypeScript for the lumo_box
 * connector registry. Same invariants, same limits, same attack-surface
 * boundaries; upstream changes land as patches to this file.
 *
 * Differences from upstream (documented, intentional):
 * - Execution dispatches to the BashConnector with a literal argv
 *   (`bash__script` mode) instead of the Rust registry's script envelope.
 * - Account binding uses the proxied app's account identity (single user).
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** Up to 200 assets plus the root SKILL.md. */
const MAX_FILES = 201;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_ID_LEN = 128;
const MAX_PATH_LEN = 1024;
const MAX_ARGS = 256;
const MAX_ARG_BYTES = 128 * 1024;

export interface CacheFile {
  path: string;
  /** base64-encoded file content (the wire format from the vendored bridge). */
  data: string;
}

export interface CacheEntry {
  skillId: string;
  revision: string;
}

export interface RetainedSkill {
  skillId: string;
}

export interface ScriptRequest {
  skillId: string;
  revision: string;
  skillPath: string;
  scriptPath: string;
  args: string[];
}

/** Literal argv for the bash connector's script mode. */
export interface ScriptInput {
  program: string;
  args: string[];
}

const digest = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Windows device names must not select a different file on any platform. */
function isWindowsDeviceName(stem: string): boolean {
  const upper = stem.split(".")[0]?.toUpperCase() ?? "";
  if (["CON", "PRN", "AUX", "NUL"].includes(upper)) return true;
  if (!/^COM|^LPT/.test(upper)) return false;
  return ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].includes(
    upper.slice(3),
  );
}

/**
 * Reject traversal and cross-platform aliases. A bundle written on one OS
 * must stay safe everywhere: case collisions and DOS device names must not
 * select a different file.
 */
export function validatePath(filePath: string): void {
  if (filePath.length === 0 || filePath.length > MAX_PATH_LEN) {
    throw new Error("Invalid skill file path");
  }
  for (const part of filePath.split("/")) {
    if (
      part.length === 0 ||
      part === "." ||
      part === ".." ||
      /[. ]$/.test(part) ||
      /[\u0000-\u001f]/.test(part) ||
      /[\\:<>\"|?*]/.test(part) ||
      isWindowsDeviceName(part)
    ) {
      throw new Error("Invalid skill file path");
    }
  }
}

function decodeFiles(files: CacheFile[]): Map<string, Buffer> {
  if (files.length === 0 || files.length > MAX_FILES) {
    throw new Error("Invalid skill file count");
  }
  const decoded = new Map<string, Buffer>();
  const names = new Set<string>();
  let total = 0;
  for (const file of files) {
    validatePath(file.path);
    const lower = file.path.toLowerCase();
    if (names.has(lower)) {
      throw new Error("Duplicate skill file path");
    }
    names.add(lower);
    if (file.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
      throw new Error("Skill file exceeds runtime size limit");
    }
    let data: Buffer;
    try {
      data = Buffer.from(file.data, "base64");
    } catch {
      throw new Error("Invalid skill file data");
    }
    if (
      data.length > MAX_FILE_BYTES ||
      (total += data.length) > MAX_TOTAL_BYTES
    ) {
      throw new Error("Skill bundle exceeds runtime size limit");
    }
    decoded.set(file.path, data);
  }
  // Reject both file/directory aliases (a and a/b) and differently-cased dirs.
  const directories = new Map<string, string>();
  for (const filePath of decoded.keys()) {
    let parent = path.posix.dirname(filePath);
    while (parent && parent !== "." && parent !== "/") {
      const folded = parent.toLowerCase();
      if (names.has(folded) || directories.get(folded)) {
        if (directories.get(folded) !== parent && names.has(folded)) {
          throw new Error("Conflicting skill paths");
        }
      }
      if (!directories.has(folded)) directories.set(folded, parent);
      else if (directories.get(folded) !== parent) {
        throw new Error("Conflicting skill paths");
      }
      parent = path.posix.dirname(parent);
    }
  }
  return decoded;
}

const INTERPRETERS: Record<string, string> = {
  py: process.platform === "win32" ? "python" : "python3",
  js: "node",
  mjs: "node",
  cjs: "node",
  sh: "sh",
  bash: "bash",
  zsh: "zsh",
  rb: "ruby",
  pl: "perl",
  ps1: "pwsh",
};

/**
 * Plaintext bundle holder. In-flight executions (including approval waits)
 * hold references; a retired bundle (replacement/GC) removes its files only
 * after the last reference drops, so running scripts never lose ground under
 * their feet. refs reaching zero alone removes nothing.
 */
class BundleLease {
  private refs = 0;
  private retired = false;

  constructor(
    readonly revision: string,
    readonly path: string,
  ) {}

  acquire(): void {
    if (this.retired) throw new Error("Skill bundle is unavailable");
    this.refs++;
  }

  release(): void {
    this.refs = Math.max(0, this.refs - 1);
    if (this.retired && this.refs === 0) {
      // Only the bundle path itself; the account dir is wiped wholesale
      // on account change (activate) and never per-bundle (upstream
      // remove_bundle semantics).
      void rm(this.path, { recursive: true, force: true }).catch(() => {});
    }
  }

  retire(): void {
    this.retired = true;
  }
}

/**
 * Per-account skill cache. `activate(null)` on sign-out clears everything
 * (upstream invariant: sign-out cannot be followed by an old request
 * recreating plaintext files).
 */
export class SkillCache {
  private account: string | null = null;
  private available = false;
  private readonly bundles = new Map<string, BundleLease>();

  constructor(private readonly root: string) {
    this.available = true;
  }

  /** Bind to an account; a change clears the cache. `available` flips back
   * once the runtime root is gone (or never existed) — synchronously when
   * there is nothing to remove, so a fresh sign-in has no async gap. */
  activate(account: string | null): void {
    if (this.account === account) return;
    this.available = false;
    for (const lease of this.bundles.values()) {
      lease.retire();
    }
    this.bundles.clear();
    if (existsSync(this.root)) {
      void rm(this.root, { recursive: true, force: true })
        .then(() => (this.available = true))
        .catch(() => (this.available = false));
    } else {
      this.available = true;
    }
    this.account = account;
  }

  private authorize(account: string): void {
    if (!this.available) {
      throw new Error("Skill runtime cache is unavailable");
    }
    if (this.account !== account) {
      throw new Error("Skill cache account does not match the active account");
    }
  }

  /**
   * Materialize a bundle from base64 files. The client-supplied content
   * revision decides idempotency — local files are not a sync input.
   */
  async materialize(
    account: string,
    entry: CacheEntry,
    files: CacheFile[],
  ): Promise<void> {
    if (
      entry.skillId.length === 0 ||
      entry.skillId.length > MAX_ID_LEN ||
      entry.revision.length > MAX_ID_LEN
    ) {
      throw new Error("Invalid skill cache entry");
    }
    this.authorize(account);
    if (this.bundles.get(entry.skillId)?.revision === entry.revision) {
      return;
    }
    const decoded = decodeFiles(files);
    const accountDir = path.join(this.root, digest(account));
    await mkdir(accountDir, { recursive: true, mode: 0o700 });
    const staging = path.join(accountDir, `staging-${randomUUID()}`);
    await mkdir(staging, { mode: 0o700 });
    try {
      for (const [name, data] of decoded) {
        const file = path.join(staging, name);
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        // create_new also catches filesystem aliases (Unicode normalization)
        // not detectable by comparing path strings.
        const handle = await open(file, "wx", 0o600);
        try {
          await handle.writeFile(data);
        } finally {
          await handle.close();
        }
      }
      const bundlePath = path.join(
        accountDir,
        `${digest(entry.skillId)}-${randomUUID()}`,
      );
      await rename(staging, bundlePath);
      // Replace any prior revision; its files are removed once in-flight
      // executions release their leases.
      const old = this.bundles.get(entry.skillId);
      if (old && old.revision !== entry.revision) old.retire();
      this.bundles.set(
        entry.skillId,
        new BundleLease(entry.revision, bundlePath),
      );
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Validate the request and produce the literal argv. Throws unless the
   * bundle exists, the revision matches, and the script resolves inside
   * the bundle root.
   */
  async scriptInput(
    account: string,
    request: ScriptRequest,
  ): Promise<{ input: ScriptInput; release: () => void }> {
    this.authorize(account);
    const lease = this.bundles.get(request.skillId);
    if (!lease) throw new Error("Skill bundle is not synced");
    if (lease.revision !== request.revision) {
      throw new Error("Skill revision changed; retry execution");
    }
    validatePath(request.scriptPath);
    if (request.skillPath.length > 0) {
      validatePath(request.skillPath);
    }
    if (
      request.args.length > MAX_ARGS ||
      request.args.some(
        (arg) => arg.length > MAX_ARG_BYTES || arg.includes("\0"),
      )
    ) {
      throw new Error("Invalid script arguments");
    }
    lease.acquire();
    try {
      const root = await realpath(lease.path);
      const script = await realpath(path.join(lease.path, request.scriptPath));
      if (!script.startsWith(root + path.sep) && script !== root) {
        throw new Error("Invalid bundled script");
      }
      const st = await stat(script);
      if (!st.isFile()) throw new Error("Invalid bundled script");
      const ext = path.extname(script).slice(1).toLowerCase();
      const program = INTERPRETERS[ext];
      if (!program) throw new Error("Unsupported script interpreter");
      const skillRoot = path.join(root, request.skillPath);
      const replace = (value: string): string =>
        value
          .replaceAll("${CLAUDE_PLUGIN_ROOT}", root)
          .replaceAll("${CLAUDE_SKILL_DIR}", skillRoot);
      const args = [script, ...request.args.map(replace)];
      return { input: { program, args }, release: () => lease.release() };
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  /** GC: drop every bundle not in the retained set. */
  retain(account: string, entries: RetainedSkill[]): void {
    this.authorize(account);
    const live = new Set(entries.map((entry) => entry.skillId));
    for (const [id, lease] of this.bundles) {
      if (!live.has(id)) {
        this.bundles.delete(id);
        lease.retire();
        lease.release();
      }
    }
  }
}
