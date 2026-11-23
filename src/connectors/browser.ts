/**
 * Browser connector: `browser__fetch` fetches a URL on the server — no CORS
 * limits, the body returns as text into the chat.
 */

import type { ToolPolicy } from "../app/config.js";
import {
  ConnectorError,
  type ConnectorManifest,
  type ConnectorTool,
} from "./types.js";

const TOOL_DEFS: ConnectorTool[] = [
  {
    name: "fetch",
    description:
      "Fetch a URL from the server. Web pages come back as plain text (tags stripped); other content types as raw body text.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL" },
      },
      required: ["url"],
    },
  },
];

const MAX_BODY_CHARS = 200_000;
const TIMEOUT_MS = 20_000;

// SSRF guard: the tool must not become a proxy into the server's own LAN
// or its loopback services (config UI, metrics, Docker socket...).
function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "::" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^fc00:/i.test(host) ||
    /^fe80:/i.test(host)
  );
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'");
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export class BrowserConnector {
  readonly id = "browser";

  constructor(private readonly policy: ToolPolicy) {}

  manifest(
    enabled: boolean,
    _filesystemRoots: readonly string[],
  ): ConnectorManifest {
    return {
      id: this.id,
      display_name: "Browser",
      version: "1.0.0",
      readiness: { state: "ready" },
      status: { state: "ready" },
      enabled,
      tools: TOOL_DEFS,
    };
  }

  policyFor(): "auto" | "ask" | "deny" {
    return this.policy;
  }

  hasTool(toolName: string): boolean {
    return toolName === "fetch";
  }

  async run(toolName: string, input: unknown): Promise<unknown> {
    if (toolName !== "fetch") {
      throw new ConnectorError(
        `Unknown tool browser__${toolName}`,
        "not_found",
      );
    }
    const url =
      typeof input === "object" && input !== null && "url" in input
        ? (input as { url: unknown }).url
        : undefined;
    if (typeof url !== "string" || url.length === 0) {
      throw new ConnectorError(
        "browser__fetch requires a url",
        "invalid_input",
      );
    }

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new ConnectorError(`Invalid URL: ${url}`, "invalid_input");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new ConnectorError(
        `Unsupported URL scheme: ${target.protocol}`,
        "invalid_input",
      );
    }
    if (isBlockedHost(target.hostname)) {
      throw new ConnectorError(
        "Refusing to fetch local or private network addresses",
        "denied",
      );
    }

    let res: Response;
    try {
      res = await fetch(target, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "lumo-tamer-browser-connector" },
      });
    } catch (error) {
      throw new ConnectorError(
        `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        "execution",
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const body = contentType.includes("html") ? htmlToText(raw) : raw;
    return {
      status: res.status,
      contentType,
      finalUrl: res.url,
      body: body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body,
      truncated: body.length > MAX_BODY_CHARS,
    };
  }
}
