/**
 * Shrink what goes UP to Lumo without touching what is persisted: agent
 * sessions re-send the full history every request and old tool results
 * dominate the prompt. Only tool results outside the recent window are
 * stubbed to a header line; the recent window stays byte-identical.
 */

import { getCompactionConfig } from "../app/config.js";
import { logger } from "../app/logger.js";
import { Role, TOOL_RESULT_PREFIX, type Turn } from "./types.js";

const isToolResult = (turn: Turn): boolean =>
  turn.role === Role.User &&
  (turn.content ?? "").trimStart().startsWith(TOOL_RESULT_PREFIX);

/** Replace a tool-result body with a one-line stub, keeping the header. */
const stubToolResult = (turn: Turn): Turn => {
  const content = turn.content ?? "";
  const newline = content.indexOf("\n");
  const header = newline >= 0 ? content.slice(0, newline) : content;
  return {
    ...turn,
    content: `${header}\n[output of ${content.length} chars omitted by compaction]`,
  };
};

/** Compact old oversized tool results; returns a new array, input untouched. */
export function compactTurns(turns: Turn[]): Turn[] {
  const config = getCompactionConfig();
  if (!config.enabled || turns.length <= config.keepRecentTurns) {
    return turns;
  }

  const cutoff = turns.length - config.keepRecentTurns;
  let stubbed = 0;
  let charsSaved = 0;
  const compacted = turns.map((turn, i) => {
    if (
      i >= cutoff ||
      !isToolResult(turn) ||
      (turn.content ?? "").length <= config.minToolResultChars
    ) {
      return turn;
    }
    const stub = stubToolResult(turn);
    stubbed++;
    charsSaved += (turn.content ?? "").length - (stub.content ?? "").length;
    return stub;
  });

  if (stubbed > 0) {
    logger.info(
      { stubbed, charsSaved, keptRecent: config.keepRecentTurns },
      "Compacted old tool results before sending",
    );
  }
  return compacted;
}
