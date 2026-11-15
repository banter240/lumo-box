/**
 * Outgoing-request pacing. Keeps a minimum interval between consecutive
 * Proton completions and adds human-like timing: skewed jitter, rare long
 * pauses, simulated reading/typing waits sized by the raw turn, burst-aware
 * spacing, and a night-time slowdown. Tool-result continuations and bounces
 * are machine-fed and pay a short processing pause instead.
 */
import { logger } from "../app/logger.js";
import { getMetrics } from "../app/metrics.js";
import { getPacingConfig, type PacingConfig } from "../app/config.js";
import { Role, type Turn, TOOL_RESULT_PREFIX } from "./types.js";

/** Earliest allowed dispatch time for the next request. */
let nextSlot = 0;

/** Scheduled dispatch time of the previous request. */
let lastDispatchAt = 0;

/** Length of the last Lumo reply, for the simulated reading pause. */
let lastResponseChars = 0;

/** Symmetric triangular draw in [-1, 1]: two uniforms minus one. */
const triangular = () => Math.random() + Math.random() - 1;

/** How a completion is paced. Classified from the RAW turns before any
 *  instruction injection: the injected block would break the
 *  [Tool Result: prefix and inflate the typing measurement. */
export type PacingPlan =
  { kind: "user"; typingChars: number } | { kind: "machine" } | { kind: "aux" };

/** True when the last turn carries a proxy-fed tool result. Nobody types
 *  those; a length-proportional typing pause there would correlate wait
 *  time perfectly with tool-output size — a machine signature. */
export function isToolResultTurn(turns: Turn[]): boolean {
  const last = turns[turns.length - 1];
  return (
    !!last &&
    last.role === Role.User &&
    (last.content ?? "").trimStart().startsWith(TOOL_RESULT_PREFIX)
  );
}

/** Classify a completion by who authored its last turn:
 *  - machine: bounces and tool-result continuations (short processing pause)
 *  - aux: title generations (jitter only — background machine traffic)
 *  - user: genuine input (reading + typing simulation on the raw text) */
export function classifyTurnPacing(
  turns: Turn[],
  isBounce: boolean,
): PacingPlan {
  if (isBounce || isToolResultTurn(turns)) return { kind: "machine" };
  const last = turns[turns.length - 1];
  return { kind: "user", typingChars: last?.content?.length ?? 0 };
}

/** Feed the length of the latest reply; consumed by the next paced request. */
export function noteResponseVolume(chars: number): void {
  lastResponseChars = Math.max(0, Math.round(chars));
}

export function isQuietHour(
  hour: number,
  circadian: PacingConfig["circadian"],
): boolean {
  const { startHour, endHour } = circadian;
  if (startHour === endHour) return true;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

/**
 * Reserve the next dispatch slot and return how long to wait.
 * Pure bookkeeping; the caller does the sleeping. Concurrent callers get
 * distinct slots because nextSlot advances on every call.
 */
export function computePacingDelay(
  cfg: PacingConfig,
  plan: PacingPlan,
  now = Date.now(),
): number {
  if (!cfg.enabled) return 0;

  // Burst detection: quick back-and-forth means an active exchange; a gap
  // beyond burst.gapMs ends it and the next request starts a fresh session.
  const idleMs = lastDispatchAt > 0 ? now - lastDispatchAt : Infinity;
  const inBurst = cfg.burst.enabled && idleMs < cfg.burst.gapMs;
  // Only burst tracking may retire a stale slot; with bursts off the
  // serialized minimum interval must hold unconditionally.
  if (cfg.burst.enabled && lastDispatchAt > 0 && !inBurst) nextSlot = 0;

  // Skewed jitter: exponent > 1 yields mostly short delays with rare long
  // ones, closer to human reaction times than a uniform spread.
  const jitterRange = Math.max(0, cfg.maxJitterMs - cfg.minJitterMs);
  const jitter =
    cfg.minJitterMs + jitterRange * Math.random() ** cfg.jitterSkew;
  let delay = jitter;

  if (plan.kind === "user") {
    // Rare "got distracted" pause.
    if (Math.random() < cfg.longPauseChance) {
      const pauseRange = Math.max(0, cfg.longPauseMaxMs - cfg.longPauseMinMs);
      delay += cfg.longPauseMinMs + Math.random() * pauseRange;
    }

    // Simulated reading: a human skims the previous reply before continuing
    // — at varying speed, and sometimes just glances past it. A fixed
    // length-to-delay ratio would correlate perfectly with reply size.
    if (cfg.readingPause.enabled && lastResponseChars > 0) {
      if (Math.random() >= cfg.noise.skipReadingChance) {
        const speed =
          cfg.readingPause.charsPerSec *
          (1 + triangular() * cfg.noise.speedJitterFraction);
        delay += Math.min(
          (lastResponseChars / speed) * 1000,
          cfg.readingPause.maxMs,
        );
      }
      lastResponseChars = 0; // consumed either way
    }

    // Simulated typing: the outgoing message is typed before it is sent,
    // occasionally pasted instead.
    if (cfg.typingPause.enabled && plan.typingChars > 0) {
      if (Math.random() >= cfg.noise.skipTypingChance) {
        const speed =
          cfg.typingPause.charsPerSec *
          (1 + triangular() * cfg.noise.speedJitterFraction);
        delay += Math.min(
          (plan.typingChars / speed) * 1000,
          cfg.typingPause.maxMs,
        );
      }
    }
  } else if (plan.kind === "machine" && cfg.processingPause.enabled) {
    // Machine-fed continuations: glance at the tool result / bounce feedback,
    // then continue. Short uniform pause — real reasoning happens server-side
    // (Lumo's own latency), so proportional scaling would be pure theater.
    const range = Math.max(
      0,
      cfg.processingPause.maxMs - cfg.processingPause.minMs,
    );
    delay += cfg.processingPause.minMs + Math.random() * range;
  }
  // "aux" (title generation): jitter only — background machine traffic.

  // A fresh session after idle starts with a "sat back down" wait.
  if (cfg.burst.enabled && lastDispatchAt > 0 && !inBurst) {
    delay += cfg.burst.resumeDelayMs;
  }

  if (
    cfg.circadian.enabled &&
    isQuietHour(new Date(now).getHours(), cfg.circadian)
  ) {
    delay *= cfg.circadian.multiplier;
  }

  // Multiplicative wobble over the summed delay, so the composition never
  // reproduces identical timing patterns across sessions.
  delay = Math.max(0, delay * (1 + triangular() * cfg.noise.sigma));

  // Jitter the enforced interval itself: under sustained load the observed
  // gaps would otherwise pile up on one exact value, which no human does.
  const intervalJitter = 1 + triangular() * cfg.noise.intervalJitterFraction;
  const minInterval = Math.max(
    1,
    Math.round(
      (inBurst
        ? Math.min(cfg.minIntervalMs, cfg.burst.activeIntervalMs)
        : cfg.minIntervalMs) * intervalJitter,
    ),
  );
  let floor = nextSlot;
  if (inBurst) {
    // The previous dispatch happened inside this burst; relax its spacing
    // to the active interval instead of the full minimum.
    floor = Math.min(floor, lastDispatchAt + minInterval);
  }
  const earliest = Math.max(floor, Math.round(now + delay));
  nextSlot = earliest + minInterval;
  lastDispatchAt = earliest;
  return Math.max(0, earliest - now);
}

/** Exponential backoff for retryable Proton errors, with ±jitterFraction. */
export function computeRetryDelay(
  retry: PacingConfig["retry"],
  attempt: number,
): number {
  const base = Math.min(
    retry.initialDelayMs * 2 ** (attempt - 1),
    retry.maxDelayMs,
  );
  const jitter = 1 + (Math.random() * 2 - 1) * retry.jitterFraction;
  return Math.max(0, Math.round(base * jitter));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sleepUnlessTesting(ms: number): Promise<void> {
  // Delays are unit-tested via the pure compute* functions; keep suites fast.
  if (process.env.VITEST) return;
  await sleep(ms);
}

/** Block until the next request may go out. Call right before dispatching. */
export async function paceOutgoingRequest(plan: PacingPlan): Promise<void> {
  const waitMs = computePacingDelay(getPacingConfig(), plan);
  const metrics = getMetrics();
  metrics?.pacingWaitMs.observe(waitMs);
  metrics?.pacingWaitsTotal.inc({
    outcome: waitMs > 0 ? "paced" : "immediate",
  });
  if (waitMs > 0) {
    logger.debug({ waitMs, kind: plan.kind }, "Pacing outgoing request");
    await sleepUnlessTesting(waitMs);
  }
}

/** Backoff sleep between retry attempts. */
export async function backoffSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  logger.debug({ ms }, "Backing off before retry");
  await sleepUnlessTesting(ms);
}
