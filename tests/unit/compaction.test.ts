/**
 * Unit tests for turn compaction (src/lumo-client/compaction.ts).
 */

import { describe, it, expect, vi } from "vitest";
import { compactTurns } from "../../src/lumo-client/compaction.js";
import {
  Role,
  TOOL_RESULT_PREFIX,
  type Turn,
} from "../../src/lumo-client/types.js";

vi.mock("../../src/app/config.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getCompactionConfig: vi.fn(() => ({
    enabled: true,
    keepRecentTurns: 3,
    minToolResultChars: 1000,
  })),
}));

const longResult = (name: string, chars: number): Turn => {
  const body = "x".repeat(chars);
  return {
    role: Role.User,
    content: `${TOOL_RESULT_PREFIX} ${name}]\n${body}`,
  };
};

const textTurn = (text: string): Turn => ({
  role: Role.User,
  content: text,
});

const assistantTurn = (text: string): Turn => ({
  role: Role.Assistant,
  content: text,
});

import { getCompactionConfig } from "../../src/app/config.js";

describe("compactTurns", () => {
  it("returns the input untouched when under keepRecentTurns", () => {
    const turns = [textTurn("a"), longResult("bash", 5000)];
    expect(compactTurns(turns)).toEqual(turns);
  });

  it("stubs long tool results outside the recent window", () => {
    const turns = [
      longResult("bash", 5000),
      assistantTurn("working"),
      longResult("read", 5000),
      assistantTurn("thinking"),
      longResult("grep", 5000),
      textTurn("now do the next thing"),
    ];
    const result = compactTurns(turns);
    // keepRecentTurns=3: indices 3..5 stay identical
    expect(result[5]).toBe(turns[5]);
    expect(result[4]).toBe(turns[4]);
    expect(result[3]).toBe(turns[3]);
    // 0..2: the long tool results are stubbed, assistant turns untouched.
    // The stub reports the FULL original content length (header + body).
    expect(result[0].content).toContain("[output of 5020 chars omitted");
    expect(result[0].content).toContain("[Tool Result: bash]");
    expect(result[2].content).toContain("[output of 5020 chars omitted");
    expect(result[1]).toBe(turns[1]);
  });

  it("leaves short tool results and non-tool turns alone", () => {
    // 7 turns, window keeps the last 3: the long result at index 1 sits
    // outside the window, the short one at index 0 does too.
    const turns = [
      longResult("bash", 200),
      longResult("read", 5000),
      assistantTurn("a"),
      textTurn("b"),
      longResult("grep", 5000),
      textTurn("go"),
      textTurn("now"),
    ];
    const result = compactTurns(turns);
    expect(result[0]).toBe(turns[0]); // short result: left alone
    expect(result[1].content).toContain("[output of 5020 chars omitted");
    expect(result[2]).toBe(turns[2]);
    expect(result[4]).toBe(turns[4]); // inside the recent window
  });

  it("does not mutate the input array", () => {
    const turns = [
      longResult("bash", 5000),
      textTurn("a"),
      textTurn("b"),
      textTurn("c"),
    ];
    const snapshot = turns.map((t) => ({ ...t }));
    compactTurns(turns);
    expect(turns).toEqual(snapshot);
  });

  it("does nothing when disabled", () => {
    vi.mocked(getCompactionConfig).mockReturnValueOnce({
      enabled: false,
      keepRecentTurns: 3,
      minToolResultChars: 1000,
    });
    const turns = [
      longResult("bash", 5000),
      textTurn("a"),
      textTurn("b"),
      textTurn("c"),
    ];
    expect(compactTurns(turns)).toBe(turns);
  });
});
