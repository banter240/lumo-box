/**
 * Connector engine tests: containment, policies, approvals, execution.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FilesystemConnector } from "../../src/connectors/filesystem.js";
import { BashConnector } from "../../src/connectors/bash.js";
import { BrowserConnector } from "../../src/connectors/browser.js";
import { ConnectorRegistry } from "../../src/connectors/registry.js";
import { ApprovalGate } from "../../src/connectors/approval-gate.js";
import { ConnectorError } from "../../src/connectors/types.js";
import type { WebappConfig } from "../../src/app/config.js";
import type { ApprovalRequest } from "../../src/connectors/types.js";

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "connectors-test-root-"));
  outside = mkdtempSync(join(tmpdir(), "connectors-test-outside-"));
  writeFileSync(join(root, "notes.txt"), "hello connectors\n");
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "deep.md"), "deep content");
  // symlink from inside the root pointing outside of it
  symlinkSync(outside, join(root, "escape-link"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function fsConnector(
  write: "auto" | "ask" | "deny" = "deny",
): FilesystemConnector {
  return new FilesystemConnector([root], "auto", write);
}

function expectConnectorError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  return promise.then(
    () => {
      throw new Error("expected ConnectorError");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).code).toBe(code);
    },
  );
}

describe("filesystem containment", () => {
  it("reads a file inside the root", async () => {
    const content = await fsConnector().run("fs_read", { path: "notes.txt" });
    expect(content).toContain("hello connectors");
  });

  it("reads by absolute path inside the root", async () => {
    const content = await fsConnector().run("fs_read", {
      path: join(root, "sub", "deep.md"),
    });
    expect(content).toBe("deep content");
  });

  it("rejects paths outside the roots", async () => {
    await expectConnectorError(
      fsConnector().run("fs_read", { path: join(outside, "x.txt") }),
      "outside_roots",
    );
  });

  it("rejects ../ traversal outside the root", async () => {
    await expectConnectorError(
      fsConnector().run("fs_read", { path: "../evil.txt" }),
      "outside_roots",
    );
  });

  it("rejects symlink escapes", async () => {
    writeFileSync(join(outside, "secret.txt"), "top secret");
    await expectConnectorError(
      fsConnector().run("fs_read", { path: "escape-link/secret.txt" }),
      "outside_roots",
    );
  });

  it("rejects missing or non-string paths", async () => {
    await expectConnectorError(
      fsConnector().run("fs_read", { path: "" }),
      "invalid_input",
    );
    await expectConnectorError(
      fsConnector().run("fs_read", {}),
      "invalid_input",
    );
  });
});

describe("filesystem search and writes", () => {
  it("searches recursively and skips node_modules", async () => {
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "dont-find-me.js"), "x");
    const result = (await fsConnector().run("fs_search", {
      query: ".txt",
    })) as { matches: string[] };
    expect(result.matches).toContain("notes.txt");
    expect(result.matches.some((m) => m.includes("dont-find-me"))).toBe(false);
  });

  it("writes inside the root when policy allows", async () => {
    const result = (await fsConnector("auto").run("fs_write", {
      path: "new/created.txt",
      content: "written",
    })) as { bytes: number };
    expect(result.bytes).toBe(7);
    const readBack = await fsConnector().run("fs_read", {
      path: "new/created.txt",
    });
    expect(readBack).toBe("written");
  });

  it("edits with exact unique match", async () => {
    await fsConnector("auto").run("fs_edit", {
      path: "notes.txt",
      old: "hello",
      new: "goodbye",
    });
    const content = await fsConnector().run("fs_read", { path: "notes.txt" });
    expect(content).toContain("goodbye connectors");
  });

  it("refuses ambiguous edits", async () => {
    writeFileSync(join(root, "twice.txt"), "abab");
    await expectConnectorError(
      fsConnector("auto").run("fs_edit", {
        path: "twice.txt",
        old: "ab",
        new: "xy",
      }),
      "execution",
    );
  });
});

describe("bash connector", () => {
  it("runs code and reports the exit code", async () => {
    const bash = new BashConnector({ bash: ["bash", "-c"] }, 10, "auto");
    const result = (await bash.run("run", {
      language: "bash",
      code: "echo hi; echo err >&2",
    })) as { exit_code: number | null; output: string };
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("hi");
    expect(result.output).toContain("err");
  });

  it("captures non-zero exits", async () => {
    const bash = new BashConnector({ bash: ["bash", "-c"] }, 10, "auto");
    const result = (await bash.run("run", {
      language: "bash",
      code: "exit 3",
    })) as { exit_code: number | null };
    expect(result.exit_code).toBe(3);
  });

  it("kills long runs on timeout", async () => {
    const bash = new BashConnector({ bash: ["bash", "-c"] }, 1, "auto");
    const result = (await bash.run("run", {
      language: "bash",
      code: "sleep 30",
    })) as { output: string };
    expect(result.output).toContain("timeout");
  }, 15000);

  it("rejects unconfigured languages", async () => {
    const bash = new BashConnector({ bash: ["bash", "-c"] }, 10, "auto");
    await expectConnectorError(
      bash.run("run", { language: "cobol", code: "x" }),
      "invalid_input",
    );
  });
});

describe("approval gate", () => {
  it("times out to denied when nobody answers", async () => {
    const gate = new ApprovalGate(20);
    const result = await gate.ask("bash", "run", { code: "x" });
    expect(result).toBe(false);
    expect(gate.pendingCount()).toBe(0);
  });

  it("resolves when responded in time", async () => {
    const requests: ApprovalRequest[] = [];
    const gate = new ApprovalGate(5000, (request) => requests.push(request));
    const decision = gate.ask("bash", "run", { code: "x" });
    const request = await new Promise<ApprovalRequest>((resolve) => {
      const poll = setInterval(() => {
        if (requests.length > 0) {
          clearInterval(poll);
          resolve(requests[0]!);
        }
      }, 5);
    });
    expect(gate.respond(request.requestId, true)).toBe(true);
    expect(await decision).toBe(true);
  });

  it("ignores answers for unknown ids", () => {
    const gate = new ApprovalGate(1000);
    expect(gate.respond("nope", true)).toBe(false);
  });
});

describe("registry policy routing", () => {
  function registry(onAsk?: (request: ApprovalRequest) => void) {
    const config = {
      filesystem: {
        enabled: true,
        roots: [root],
        read: "auto",
        write: "deny",
      },
      bash: {
        enabled: true,
        policy: "ask",
        executors: { bash: ["bash", "-c"] },
        timeoutSec: 10,
      },
      browser: { enabled: false, policy: "auto" },
      approvals: { timeoutSec: 1 },
    } as unknown as WebappConfig["connectors"];
    return new ConnectorRegistry(config, onAsk);
  }

  it("serves manifests and namespaced tools", () => {
    const reg = registry();
    const ids = reg
      .manifests()
      .map((m) => m.id)
      .sort();
    // Desktop contract (tools.rs): filesystem + bash register always; the
    // browser connector is not part of the desktop registry.
    expect(ids).toEqual(["bash", "filesystem"]);
    const names = reg.namespacedTools().map((t) => t.name);
    expect(names).toContain("filesystem__fs_read");
    expect(names).toContain("bash__run");
  });

  it("runs auto-policy reads directly", async () => {
    const reg = registry();
    const content = await reg.invoke("filesystem", "fs_read", {
      path: "notes.txt",
    });
    expect(content).toContain("connectors");
  });

  it("blocks deny-policy writes", async () => {
    const reg = registry();
    await expectConnectorError(
      reg.invoke("filesystem", "fs_write", { path: "x.txt", content: "x" }),
      "denied",
    );
  });

  it("holds ask-policy calls until approved", async () => {
    const reg = registry((request) => {
      // deny asynchronously, like the SSE responder would
      setTimeout(() => reg.respondApproval(request.requestId, true), 10);
    });
    const result = (await reg.invoke("bash", "run", {
      language: "bash",
      code: "echo approved-run",
    })) as { output: string };
    expect(result.output).toContain("approved-run");
  });

  it("denies ask-policy calls when the answer is no", async () => {
    const reg = registry((request) => {
      setTimeout(() => reg.respondApproval(request.requestId, false), 10);
    });
    await expectConnectorError(
      reg.invoke("bash", "run", { language: "bash", code: "echo x" }),
      "denied",
    );
  });

  it("forces read-only in schedule context even for auto tools", async () => {
    const reg = registry();
    await expectConnectorError(
      reg.invoke(
        "filesystem",
        "fs_write",
        { path: "sched.txt", content: "x" },
        { read_only: true },
      ),
      "denied",
    );
  });

  it("rejects unknown connectors and tools", async () => {
    const reg = registry();
    await expectConnectorError(reg.invoke("nope", "run", {}), "not_found");
    await expectConnectorError(
      reg.invoke("filesystem", "not_a_tool", {}),
      "not_found",
    );
  });
});

describe("browser connector", () => {
  // Desktop does not register the browser connector; the class is kept as a
  // standalone building block, so these tests exercise it directly.
  function browser(policy: "auto" | "ask" | "deny" = "auto") {
    return new BrowserConnector(policy);
  }

  it("fetches a public URL and returns text", async () => {
    const result = (await browser().run("fetch", {
      url: "https://example.com/",
    })) as { status: number; body: string };
    expect(result.status).toBe(200);
    expect(result.body).toContain("Example Domain");
  });

  it("strips html tags and scripts", async () => {
    const result = (await browser().run("fetch", {
      url: "https://example.com/",
    })) as { body: string };
    expect(result.body).not.toContain("<");
  });

  it("refuses loopback and private hosts", async () => {
    for (const url of [
      "http://127.0.0.1:3020/health",
      "http://localhost/x",
      "http://192.168.1.1/router",
      "http://10.0.0.1/x",
    ]) {
      await expectConnectorError(browser().run("fetch", { url }), "denied");
    }
  });

  it("rejects invalid and non-http schemes", async () => {
    await expectConnectorError(
      browser().run("fetch", { url: "not-a-url" }),
      "invalid_input",
    );
    await expectConnectorError(
      browser().run("fetch", { url: "file:///etc/passwd" }),
      "invalid_input",
    );
  });

  it("rejects missing urls", async () => {
    await expectConnectorError(browser().run("fetch", {}), "invalid_input");
  });

  it("shows disabled connectors as not enabled instead of hiding them", () => {
    const config = {
      filesystem: { enabled: false, roots: [], read: "auto", write: "deny" },
      bash: {
        enabled: false,
        policy: "ask",
        executors: {},
        timeoutSec: 10,
      },
      browser: { enabled: false, policy: "auto" },
      approvals: { timeoutSec: 1 },
    } as unknown as WebappConfig["connectors"];
    const reg = new ConnectorRegistry(config);
    // Desktop contract (tools.rs): the registry always holds filesystem +
    // bash; disabled ones show as not connected and refuse invocation.
    expect(
      reg
        .manifests()
        .map((m) => m.id)
        .sort(),
    ).toEqual(["bash", "filesystem"]);
    expect(reg.manifests().every((m) => m.enabled === false)).toBe(true);
  });
});
