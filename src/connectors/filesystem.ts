/**
 * Filesystem connector: fs_read / fs_search / fs_write / fs_edit within
 * configured roots. Tool names follow the desktop bridge contract
 * (`filesystem__fs_read`, ...).
 *
 * Containment is checked against the realpath of the target (or its nearest
 * existing ancestor for not-yet-existing files), so a symlink inside a root
 * cannot smuggle reads or writes outside of it.
 */

import { promises as fs } from "fs";
import type { Dirent } from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import type { ToolPolicy } from "../app/config.js";
import {
  ConnectorError,
  type ConnectorManifest,
  type ConnectorTool,
} from "./types.js";

const TOOL_DEFS: ConnectorTool[] = [
  {
    name: "fs_read",
    description:
      "Read a text file inside an allowed root. Returns its content.",
    read_only: true,
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path inside an allowed root",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "fs_search",
    description:
      "Search file names recursively inside the allowed roots. Returns relative paths.",
    read_only: true,
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Case-insensitive substring matched against paths",
        },
        limit: { type: "number", description: "Max results (default 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "fs_write",
    description:
      "Create or overwrite a file inside an allowed root. Parent directories are created.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "fs_edit",
    description:
      "Replace exact text in a file inside an allowed root. old must occur exactly once.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old: { type: "string" },
        new: { type: "string" },
      },
      required: ["path", "old", "new"],
    },
  },
];

const READ_TOOLS = new Set(["fs_read", "fs_search"]);
const SEARCH_SKIP = new Set(["node_modules", ".git", ".svn"]);
const SEARCH_LIMIT_DEFAULT = 50;
const SEARCH_LIMIT_MAX = 500;

export class FilesystemConnector {
  readonly id = "filesystem";

  private readonly roots: string[];

  constructor(
    roots: readonly string[],
    private readonly readPolicy: ToolPolicy,
    private readonly writePolicy: ToolPolicy,
  ) {
    this.roots = roots.map((r) => resolve(r));
  }

  manifest(
    enabled: boolean,
    _filesystemRoots: readonly string[],
  ): ConnectorManifest {
    const ready = this.roots.length > 0;
    const detail = ready ? undefined : "Add a folder to grant access";
    return {
      id: this.id,
      display_name: "Filesystem",
      version: "1.0.0",
      readiness: {
        state: ready ? "ready" : "setup",
        ...(detail ? { detail } : {}),
      },
      status: {
        state: ready ? "ready" : "setup",
        ...(detail ? { detail } : {}),
      },
      enabled,
      tools: TOOL_DEFS,
    };
  }

  policyFor(toolName: string): ToolPolicy {
    return READ_TOOLS.has(toolName) ? this.readPolicy : this.writePolicy;
  }

  hasTool(toolName: string): boolean {
    return TOOL_DEFS.some((tool) => tool.name === toolName);
  }

  /**
   * Resolve a user-supplied path to an absolute one inside a root. Relative
   * paths resolve against each root in turn. The winner is re-checked via
   * realpath (walking up to the nearest existing ancestor) so symlinks
   * cannot point outside.
   */
  private async contained(inputPath: unknown): Promise<string> {
    if (typeof inputPath !== "string" || inputPath.trim() === "") {
      throw new ConnectorError("path is required", "invalid_input");
    }
    let expanded = inputPath;
    if (expanded === "~") {
      expanded = homedir();
    } else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
      expanded = join(homedir(), expanded.slice(2));
    }

    const candidates = isAbsolute(expanded)
      ? [resolve(expanded)]
      : this.roots.map((root) => resolve(root, expanded));

    for (const candidate of candidates) {
      const real = await this.realisticallyContained(candidate);
      if (real !== null) return real;
    }
    throw new ConnectorError(
      `Path is outside the allowed roots: ${inputPath}`,
      "outside_roots",
    );
  }

  private async realisticallyContained(
    candidate: string,
  ): Promise<string | null> {
    let current = candidate;
    const tail: string[] = [];
    for (;;) {
      let real: string;
      try {
        real = await fs.realpath(current);
      } catch {
        const parent = dirname(current);
        if (parent === current) return null;
        tail.unshift(basename(current));
        current = parent;
        continue;
      }
      const rebuilt = tail.length > 0 ? join(real, ...tail) : real;
      return this.insideRoots(rebuilt) ? rebuilt : null;
    }
  }

  private insideRoots(absolute: string): boolean {
    for (const root of this.roots) {
      const rel = relative(root, absolute);
      if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
        return true;
      }
    }
    return false;
  }

  async run(toolName: string, input: unknown): Promise<unknown> {
    switch (toolName) {
      case "fs_read":
        return this.fsRead(input);
      case "fs_search":
        return this.fsSearch(input);
      case "fs_write":
        return this.fsWrite(input);
      case "fs_edit":
        return this.fsEdit(input);
      default:
        throw new ConnectorError(
          `Unknown filesystem tool: ${toolName}`,
          "not_found",
        );
    }
  }

  private async fsRead(input: unknown): Promise<string> {
    const path = await this.contained((input as { path?: unknown })?.path);
    try {
      return await fs.readFile(path, "utf8");
    } catch (error) {
      throw new ConnectorError(
        `Cannot read ${path}: ${(error as NodeJS.ErrnoException).message}`,
      );
    }
  }

  private async fsSearch(input: unknown): Promise<unknown> {
    const args = input as { query?: unknown; limit?: unknown };
    const query =
      typeof args?.query === "string" ? args.query.toLowerCase() : "";
    if (query === "") {
      throw new ConnectorError("query is required", "invalid_input");
    }
    const requested =
      typeof args?.limit === "number"
        ? Math.floor(args.limit)
        : SEARCH_LIMIT_DEFAULT;
    const limit = Math.max(1, Math.min(requested, SEARCH_LIMIT_MAX));
    const matches: string[] = [];
    for (const root of this.roots) {
      await this.walk(root, root, query, limit, matches);
      if (matches.length >= limit) break;
    }
    return { matches: matches.slice(0, limit) };
  }

  private async walk(
    base: string,
    dir: string,
    query: string,
    limit: number,
    out: string[],
  ): Promise<void> {
    if (out.length >= limit) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subtree must not fail the whole search
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.isDirectory() && SEARCH_SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative(base, full);
      if (rel.toLowerCase().includes(query)) out.push(rel);
      if (entry.isDirectory()) {
        await this.walk(base, full, query, limit, out);
      }
    }
  }

  private async fsWrite(
    input: unknown,
  ): Promise<{ path: string; bytes: number }> {
    const args = input as { path?: unknown; content?: unknown };
    if (typeof args?.content !== "string") {
      throw new ConnectorError("content is required", "invalid_input");
    }
    const path = await this.contained(args.path);
    try {
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, args.content, "utf8");
    } catch (error) {
      throw new ConnectorError(
        `Cannot write ${path}: ${(error as NodeJS.ErrnoException).message}`,
      );
    }
    return { path, bytes: Buffer.byteLength(args.content) };
  }

  private async fsEdit(
    input: unknown,
  ): Promise<{ path: string; replacements: number }> {
    const args = input as { path?: unknown; old?: unknown; new?: unknown };
    if (typeof args?.old !== "string" || typeof args?.new !== "string") {
      throw new ConnectorError("old and new are required", "invalid_input");
    }
    if (args.old === args.new) {
      throw new ConnectorError("old and new must differ", "invalid_input");
    }
    const path = await this.contained(args.path);
    let content: string;
    try {
      content = await fs.readFile(path, "utf8");
    } catch (error) {
      throw new ConnectorError(
        `Cannot edit ${path}: ${(error as NodeJS.ErrnoException).message}`,
      );
    }
    const first = content.indexOf(args.old);
    if (first === -1) {
      throw new ConnectorError(`old text not found in ${path}`);
    }
    if (content.indexOf(args.old, first + 1) !== -1) {
      throw new ConnectorError(`old text occurs more than once in ${path}`);
    }
    const updated =
      content.slice(0, first) +
      args.new +
      content.slice(first + args.old.length);
    try {
      await fs.writeFile(path, updated, "utf8");
    } catch (error) {
      throw new ConnectorError(
        `Cannot write ${path}: ${(error as NodeJS.ErrnoException).message}`,
      );
    }
    return { path, replacements: 1 };
  }
}
