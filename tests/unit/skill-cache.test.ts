/**
 * Skill cache tests, mirroring the upstream desktop suite in
 * ProtonLumo/lumo-desktop src-tauri/src/skills.rs (GPL-3.0): literal
 * argument execution, lifecycle (sync → retain → execute), account
 * binding, traversal rejection and size limits.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SkillCache, validatePath } from "../../src/skills/skill-cache.js";

const ACCOUNT = "test-account";

const b64 = (data: string | Uint8Array): string =>
  Buffer.from(data).toString("base64");

const file = (p: string, data: string) => ({ path: p, data: b64(data) });

describe("validatePath", () => {
  it("rejects traversal", () => {
    expect(() => validatePath("../escape")).toThrow();
    expect(() => validatePath("a/../../b")).toThrow();
  });

  it("rejects absolute-looking and dot-suffixed parts", () => {
    expect(() => validatePath("./a")).toThrow();
    expect(() => validatePath("a.")).toThrow();
    expect(() => validatePath("a ")).toThrow();
    expect(() => validatePath("")).toThrow();
  });

  it("rejects windows device names and separators", () => {
    expect(() => validatePath("CON")).toThrow();
    expect(() => validatePath("COM1/x")).toThrow();
    expect(() => validatePath("a\\b")).toThrow();
    expect(() => validatePath("a:b")).toThrow();
  });

  it("accepts normal nested paths", () => {
    expect(() => validatePath("scripts/run.sh")).not.toThrow();
    expect(() => validatePath("SKILL.md")).not.toThrow();
  });
});

describe("SkillCache", () => {
  let dir: string;
  let cache: SkillCache;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "skill-cache-"));
    cache = new SkillCache(path.join(dir, "runtime"));
    cache.activate(ACCOUNT);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const entry = () => ({ skillId: "bundle", revision: "1" });

  it("synced script executes literal arguments (no injection)", async () => {
    await cache.materialize(ACCOUNT, entry(), [
      file("scripts/run.sh", "printf '%s' \"$1\""),
    ]);
    const { input, release } = await cache.scriptInput(ACCOUNT, {
      skillId: "bundle",
      revision: "1",
      skillPath: "",
      scriptPath: "scripts/run.sh",
      args: ["hello ' $(touch PWNED) ; &"],
    });
    expect(input.program).toBe("sh");
    expect(input.args[0]).toContain("scripts/run.sh");
    expect(input.args[1]).toBe("hello ' $(touch PWNED) ; &");
    release();
  });

  it("substitutes CLAUDE plugin root placeholders in arguments", async () => {
    await cache.materialize(ACCOUNT, entry(), [
      file("scripts/run.sh", 'cat "$1"'),
    ]);
    const { input, release } = await cache.scriptInput(ACCOUNT, {
      skillId: "bundle",
      revision: "1",
      skillPath: "",
      scriptPath: "scripts/run.sh",
      args: ["${CLAUDE_PLUGIN_ROOT}/data.txt"],
    });
    expect(input.args[1]).toMatch(
      /runtime\/[0-9a-f]{64}\/[0-9a-f]{64}-[0-9a-f-]{36}\/data\.txt$/,
    );
    expect(input.args[1]).not.toContain("${");
    release();
  });

  it("rejects executing a revision that is not synced", async () => {
    await cache.materialize(ACCOUNT, entry(), [file("scripts/run.sh", "true")]);
    await expect(
      cache.scriptInput(ACCOUNT, {
        skillId: "bundle",
        revision: "2",
        skillPath: "",
        scriptPath: "scripts/run.sh",
        args: [],
      }),
    ).rejects.toThrow(/revision changed/);
  });

  it("rejects scripts outside the bundle (traversal)", async () => {
    await cache.materialize(ACCOUNT, entry(), [file("scripts/run.sh", "true")]);
    await expect(
      cache.scriptInput(ACCOUNT, {
        skillId: "bundle",
        revision: "1",
        skillPath: "",
        scriptPath: "../run.sh",
        args: [],
      }),
    ).rejects.toThrow();
    await expect(
      cache.scriptInput(ACCOUNT, {
        skillId: "other",
        revision: "1",
        skillPath: "",
        scriptPath: "scripts/run.sh",
        args: [],
      }),
    ).rejects.toThrow(/not synced/);
  });

  it("retain drops stale bundles and their files", async () => {
    await cache.materialize(ACCOUNT, entry(), [file("scripts/run.sh", "true")]);
    const { input, release } = await cache.scriptInput(ACCOUNT, {
      skillId: "bundle",
      revision: "1",
      skillPath: "",
      scriptPath: "scripts/run.sh",
      args: [],
    });
    const scriptPath = input.args[0]!;
    // While leased the files stay; retain prunes once released.
    cache.retain(ACCOUNT, []);
    release();
    await new Promise((r) => setTimeout(r, 100));
    let exists = true;
    try {
      await readFile(scriptPath);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
    await expect(
      cache.scriptInput(ACCOUNT, {
        skillId: "bundle",
        revision: "1",
        skillPath: "",
        scriptPath: "scripts/run.sh",
        args: [],
      }),
    ).rejects.toThrow(/not synced/);
  });

  it("respects account isolation: activate(null) wipes plaintext", async () => {
    await cache.materialize(ACCOUNT, entry(), [file("SKILL.md", "# skill")]);
    cache.activate(null);
    await new Promise((r) => setTimeout(r, 100));
    // Root wiped…
    const entries = await readdir(path.join(dir, "runtime")).catch(() => []);
    expect(entries).toEqual([]);
    // …and a stale account can no longer materialize or execute.
    await expect(
      cache.materialize(ACCOUNT, entry(), [file("x", "x")]),
    ).rejects.toThrow(/active account/);
  });

  it("rejects duplicate and conflicting paths", async () => {
    await expect(
      cache.materialize(ACCOUNT, entry(), [
        file("a.txt", "a"),
        file("A.TXT", "a"),
      ]),
    ).rejects.toThrow();
    await expect(
      cache.materialize(ACCOUNT, entry(), [
        file("dir/file", "a"),
        file("dir", "a"),
      ]),
    ).rejects.toThrow();
  });

  it("enforces file count and size limits", async () => {
    await expect(cache.materialize(ACCOUNT, entry(), [])).rejects.toThrow(
      /file count/,
    );
    const big = "x".repeat(6 * 1024 * 1024);
    await expect(
      cache.materialize(ACCOUNT, entry(), [file("big.bin", big)]),
    ).rejects.toThrow(/size limit/);
    await expect(
      cache.materialize(ACCOUNT, { skillId: "", revision: "1" }, [
        file("a", "a"),
      ]),
    ).rejects.toThrow(/entry/);
  });

  it("limits script arguments", async () => {
    await cache.materialize(ACCOUNT, entry(), [file("scripts/run.sh", "true")]);
    const many: string[] = [];
    for (let i = 0; i < 257; i++) many.push(String(i));
    await expect(
      cache.scriptInput(ACCOUNT, {
        skillId: "bundle",
        revision: "1",
        skillPath: "",
        scriptPath: "scripts/run.sh",
        args: many,
      }),
    ).rejects.toThrow(/arguments/);
    await expect(
      cache.scriptInput(ACCOUNT, {
        skillId: "bundle",
        revision: "1",
        skillPath: "",
        scriptPath: "scripts/run.sh",
        args: ["with\0nul"],
      }),
    ).rejects.toThrow(/arguments/);
  });

  it("rejects unsupported interpreters", async () => {
    await cache.materialize(ACCOUNT, entry(), [
      file("scripts/run.exe", "true"),
    ]);
    await expect(
      cache.scriptInput(ACCOUNT, {
        skillId: "bundle",
        revision: "1",
        skillPath: "",
        scriptPath: "scripts/run.exe",
        args: [],
      }),
    ).rejects.toThrow(/interpreter/);
  });
});

describe("bundle lifecycle (retire vs refs)", () => {
  let dir: string;
  let cache: SkillCache;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "skill-lifecycle-"));
    cache = new SkillCache(path.join(dir, "runtime"));
    cache.activate(ACCOUNT);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("executing then releasing the script does NOT delete the bundle", async () => {
    await cache.materialize(ACCOUNT, { skillId: "b", revision: "1" }, [
      file("scripts/run.sh", "true"),
    ]);
    const { release } = await cache.scriptInput(ACCOUNT, {
      skillId: "b",
      revision: "1",
      skillPath: "",
      scriptPath: "scripts/run.sh",
      args: [],
    });
    release();
    await new Promise((r) => setTimeout(r, 80));
    // Bundle survives a plain execution cycle.
    const { input } = await cache.scriptInput(ACCOUNT, {
      skillId: "b",
      revision: "1",
      skillPath: "",
      scriptPath: "scripts/run.sh",
      args: [],
    });
    expect(input.args[0]).toContain("run.sh");
  });

  it("a re-synced (replaced) revision retires the old files after release", async () => {
    await cache.materialize(ACCOUNT, { skillId: "b", revision: "1" }, [
      file("scripts/old.sh", "true"),
    ]);
    const first = await cache.scriptInput(ACCOUNT, {
      skillId: "b", revision: "1", skillPath: "", scriptPath: "scripts/old.sh", args: [],
    });
    await cache.materialize(ACCOUNT, { skillId: "b", revision: "2" }, [
      file("scripts/new.sh", "true"),
    ]);
    first.release();
    await new Promise((r) => setTimeout(r, 100));
    // Old revision can no longer execute...
    await expect(
      cache.scriptInput(ACCOUNT, {
        skillId: "b", revision: "1", skillPath: "", scriptPath: "scripts/old.sh", args: [],
      }),
    ).rejects.toThrow(/revision changed/);
    // ...and the new one works.
    const second = await cache.scriptInput(ACCOUNT, {
      skillId: "b", revision: "2", skillPath: "", scriptPath: "scripts/new.sh", args: [],
    });
    expect(second.input.args[0]).toContain("new.sh");
    second.release();
  });

  it("retain removes unretained bundles only", async () => {
    await cache.materialize(ACCOUNT, { skillId: "keep", revision: "1" }, [
      file("scripts/a.sh", "true"),
    ]);
    await cache.materialize(ACCOUNT, { skillId: "drop", revision: "1" }, [
      file("scripts/b.sh", "true"),
    ]);
    cache.retain(ACCOUNT, [{ skillId: "keep" }]);
    await new Promise((r) => setTimeout(r, 80));
    const keep = await cache.scriptInput(ACCOUNT, {
      skillId: "keep", revision: "1", skillPath: "", scriptPath: "scripts/a.sh", args: [],
    });
    expect(keep.input.args[0]).toContain("a.sh");
    keep.release();
    await expect(
      cache.scriptInput(ACCOUNT, {
        skillId: "drop", revision: "1", skillPath: "", scriptPath: "scripts/b.sh", args: [],
      }),
    ).rejects.toThrow(/not synced/);
  });
});
