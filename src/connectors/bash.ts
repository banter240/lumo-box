/**
 * Bash connector: `bash__run` executes a language-tagged snippet through the
 * configured executors (same spawn pattern as the CLI local actions).
 */

import { spawn } from "child_process";
import type { ToolPolicy } from "../app/config.js";
import {
  ConnectorError,
  type ConnectorManifest,
  type ConnectorTool,
} from "./types.js";

const TOOL_DEFS: ConnectorTool[] = [
  {
    name: "run",
    description:
      "Execute code with the given language through a configured executor (e.g. bash -c). Returns stdout+stderr and the exit code.",
    input_schema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: 'Must map to a configured executor, e.g. "bash"',
        },
        code: { type: "string" },
      },
      required: ["language", "code"],
    },
  },
  {
    name: "script",
    description:
      "Execute a script file with a literal argument vector (no shell string). Used by the skill runtime; arguments are never interpolated.",
    input_schema: {
      type: "object",
      properties: {
        program: {
          type: "string",
          description: "Interpreter binary, e.g. python3 / node / bash",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Literal argv: [scriptPath, ...arguments]",
        },
      },
      required: ["program", "args"],
    },
  },
];

const MAX_OUTPUT_CHARS = 200_000;

export class BashConnector {
  readonly id = "bash";

  constructor(
    private readonly executors: Readonly<Record<string, readonly string[]>>,
    private readonly timeoutSec: number,
    private readonly policy: ToolPolicy,
  ) {}

  manifest(
    enabled: boolean,
    filesystemRoots: readonly string[],
  ): ConnectorManifest {
    // Desktop contract: disabled reports "Enable shell access"; enabled
    // without filesystem roots reports "Add folders first" (bash shares
    // the filesystem roots on desktop).
    if (!enabled) {
      return this.blockedManifest("Enable shell access", false);
    }
    if (filesystemRoots.length === 0) {
      return this.blockedManifest("Add folders first", true);
    }
    return {
      id: this.id,
      display_name: "Shell",
      version: "1.0.0",
      readiness: { state: "ready" },
      status: { state: "ready" },
      enabled: true,
      tools: TOOL_DEFS,
    };
  }

  private blockedManifest(reason: string, enabled: boolean): ConnectorManifest {
    return {
      id: this.id,
      display_name: "Shell",
      version: "1.0.0",
      readiness: { state: "blocked", detail: reason },
      status: { state: "blocked", detail: reason },
      enabled,
      tools: TOOL_DEFS,
    };
  }

  policyFor(_toolName: string): ToolPolicy {
    return this.policy;
  }

  hasTool(toolName: string): boolean {
    return TOOL_DEFS.some((tool) => tool.name === toolName);
  }

  async run(toolName: string, input: unknown): Promise<unknown> {
    if (toolName === "script") {
      const script = input as { program?: unknown; args?: unknown };
      const program = typeof script?.program === "string" ? script.program : "";
      const args = Array.isArray(script?.args)
        ? script.args.filter((a): a is string => typeof a === "string")
        : [];
      if (!program || args.length === 0) {
        throw new ConnectorError(
          "program and args are required",
          "invalid_input",
        );
      }
      return this.spawnCapture(program, args);
    }
    if (toolName !== "run") {
      throw new ConnectorError(`Unknown bash tool: ${toolName}`, "not_found");
    }
    const args = input as { language?: unknown; code?: unknown };
    const language = typeof args?.language === "string" ? args.language : "";
    const code = typeof args?.code === "string" ? args.code : "";

    if (!language || !code) {
      throw new ConnectorError(
        "language and code are required",
        "invalid_input",
      );
    }
    const executor = this.executors[language];
    if (!executor || executor.length === 0) {
      throw new ConnectorError(
        `No executor configured for language: ${language}`,
        "invalid_input",
      );
    }
    const [cmd, ...rest] = executor;

    return this.spawnCapture(cmd, [...rest, code]);
  }

  /** spawn with combined stdout/stderr capture and the configured timeout. */
  private spawnCapture(cmd: string, argv: readonly string[]): Promise<unknown> {
    return new Promise((resolve) => {
      const proc = spawn(cmd, [...argv], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let settled = false;

      const killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
        output += "\n[killed: exceeded timeout]";
      }, 1000 * this.timeoutSec);

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolve({
          exit_code: exitCode,
          output: output.slice(0, MAX_OUTPUT_CHARS),
        });
      };

      proc.stdout.on("data", (data) => {
        output += data.toString();
      });
      proc.stderr.on("data", (data) => {
        output += data.toString();
      });
      proc.on("close", finish);
      proc.on("error", (err) => {
        output += `\n[spawn error: ${err.message}]`;
        finish(null);
      });
    });
  }
}
