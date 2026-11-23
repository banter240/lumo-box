/**
 * Discovery-only capture of proxied chat requests: records the request
 * STRUCTURE (top-level keys, tool shapes, role counts) to a JSONL file
 * so the web app's real tool wire format can be read off empirically.
 * Message content is never written; the flag defaults to off.
 */

import { appendFileSync } from "fs";
import { resolveDataPath } from "../../app/paths.js";
import { getWebappConfig } from "../../app/config.js";
import type { Request } from "express";

export async function captureChatBody(
  method: string,
  pathname: string,
  req: Request,
): Promise<Buffer | undefined> {
  let enabled = false;
  try {
    enabled = getWebappConfig().wireCapture === true;
  } catch {
    enabled = false;
  }
  if (!enabled) return undefined;
  if (method !== "POST" || !pathname.endsWith("/chat/completions")) {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  try {
    const body = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const record = {
      at: new Date().toISOString(),
      path: pathname,
      topKeys: Object.keys(body),
      model: typeof body.model === "string" ? body.model : undefined,
      reasoningEffort: body.reasoning_effort,
      toolCount: tools.length,
      toolShapes: tools.slice(0, 30).map((t) => ({
        keys: Object.keys(t as object),
        name:
          typeof (t as { name?: unknown }).name === "string"
            ? (t as { name: string }).name
            : undefined,
      })),
      messageRoles: messages.reduce<Record<string, number>>((acc, m) => {
        const role = String((m as { role?: unknown }).role);
        acc[role] = (acc[role] ?? 0) + 1;
        return acc;
      }, {}),
      hasLumoExtension: body.lumo !== undefined,
    };
    appendFileSync(
      resolveDataPath("wire-capture.jsonl"),
      `${JSON.stringify(record)}\n`,
    );
  } catch {
    // Not JSON (streaming fragment, multipart, whatever): skip silently,
    // the proxy must never fail because of the recorder.
  }
  return raw;
}
