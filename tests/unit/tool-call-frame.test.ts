/**
 * decryptToolCallFrame mirrors the upstream client-tool-arguments decrypt
 * transform: ciphertext-string arguments are decrypted and re-parsed,
 * everything else passes through untouched.
 */

import { describe, it, expect } from "vitest";
import { decryptToolCallFrame } from "../../src/proton/tool-call-frame.js";

const okDecrypt = async (text: string) => `dec(${text})`;
const failingDecrypt = async () => null;

describe("decryptToolCallFrame", () => {
  it("decrypts ciphertext-string arguments and re-parses them as JSON", async () => {
    const frame = JSON.stringify({
      name: "user:edit",
      arguments: "CIPHERTEXT",
    });
    const out = await decryptToolCallFrame(frame, async (t) =>
      t === "CIPHERTEXT" ? '{"city":"Berlin"}' : null,
    );
    expect(JSON.parse(out)).toEqual({
      name: "user:edit",
      arguments: { city: "Berlin" },
    });
  });

  it("passes through frames with already-parsed object arguments", async () => {
    const frame = JSON.stringify({ name: "t", arguments: { a: 1 } });
    expect(await decryptToolCallFrame(frame, okDecrypt)).toBe(frame);
  });

  it("passes through frames with empty-string arguments", async () => {
    const frame = JSON.stringify({ name: "t", arguments: "" });
    expect(await decryptToolCallFrame(frame, okDecrypt)).toBe(frame);
  });

  it("passes the decrypted cleartext string on when it is not JSON", async () => {
    const frame = JSON.stringify({ name: "t", arguments: "CIPHERTEXT" });
    const out = await decryptToolCallFrame(frame, async () => "not json");
    expect(JSON.parse(out)).toEqual({ name: "t", arguments: "not json" });
  });

  it("passes the frame through unchanged when decryption fails", async () => {
    const frame = JSON.stringify({ name: "t", arguments: "CIPHERTEXT" });
    expect(await decryptToolCallFrame(frame, failingDecrypt)).toBe(frame);
  });

  it("passes non-JSON frames through unchanged", async () => {
    expect(await decryptToolCallFrame("garbage{", okDecrypt)).toBe("garbage{");
  });

  it("preserves sibling fields like id and name", async () => {
    const frame = JSON.stringify({ id: "call_1", name: "t", arguments: "CT" });
    const out = await decryptToolCallFrame(frame, async () => "[]");
    expect(JSON.parse(out)).toEqual({ id: "call_1", name: "t", arguments: [] });
  });
});
