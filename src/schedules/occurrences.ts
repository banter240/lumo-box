/**
 * Recurrence math for schedule timings: next occurrence strictly after a
 * reference instant, in the timing's own timezone (DST-safe via two-pass
 * offset refinement).
 */

import type { ScheduleDefinition } from "./types.js";

const tzFormatters = new Map<string, Intl.DateTimeFormat>();

function tzFormatter(timeZone: string): Intl.DateTimeFormat | null {
  let fmt = tzFormatters.get(timeZone);
  if (fmt !== undefined) return fmt;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return null;
  }
  tzFormatters.set(timeZone, fmt);
  return fmt;
}

/** Wall clock in the zone, expressed as UTC fields of epoch + offset. */
function tzOffsetMs(epoch: number, fmt: Intl.DateTimeFormat): number {
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(epoch))) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - epoch;
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dow: number;
}

function wallClock(epoch: number, fmt: Intl.DateTimeFormat): Wall {
  const shifted = new Date(epoch + tzOffsetMs(epoch, fmt));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dow: shifted.getUTCDay(),
  };
}

function epochOf(wall: Omit<Wall, "dow">, fmt: Intl.DateTimeFormat): number {
  // Date.UTC normalizes day/month overflow, so "day + 1" rolls over cleanly.
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
  );
  let epoch = guess - tzOffsetMs(guess, fmt);
  epoch = guess - tzOffsetMs(epoch, fmt);
  return epoch;
}

function parseClock(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Epoch of the next occurrence strictly after `after`; null when none. */
export function nextOccurrence(
  def: ScheduleDefinition,
  after: number,
): number | null {
  const timing = def.timing;
  switch (timing.kind) {
    case "once": {
      const at = Date.parse(timing.at);
      return Number.isFinite(at) && at > after ? at : null;
    }
    case "daily": {
      const fmt = tzFormatter(timing.timezone);
      const clock = parseClock(timing.time);
      if (!fmt || !clock) return null;
      let probe = after;
      for (let i = 0; i < 3; i++) {
        const wall = wallClock(probe, fmt);
        const candidate = epochOf(
          { ...wall, hour: clock.hour, minute: clock.minute },
          fmt,
        );
        if (candidate > after) return candidate;
        probe = epochOf(
          { ...wall, day: wall.day + 1, hour: 0, minute: 0 },
          fmt,
        );
      }
      return null;
    }
    case "weekly": {
      const fmt = tzFormatter(timing.timezone);
      const clock = parseClock(timing.time);
      if (
        !fmt ||
        !clock ||
        !Array.isArray(timing.days) ||
        timing.days.length === 0
      ) {
        return null;
      }
      let probe = after;
      for (let i = 0; i < 8; i++) {
        const wall = wallClock(probe, fmt);
        if (timing.days.includes(wall.dow)) {
          const candidate = epochOf(
            { ...wall, hour: clock.hour, minute: clock.minute },
            fmt,
          );
          if (candidate > after) return candidate;
        }
        probe = epochOf(
          { ...wall, day: wall.day + 1, hour: 0, minute: 0 },
          fmt,
        );
      }
      return null;
    }
    case "monthly": {
      const fmt = tzFormatter(timing.timezone);
      const clock = parseClock(timing.time);
      if (
        !fmt ||
        !clock ||
        !Array.isArray(timing.days) ||
        timing.days.length === 0
      ) {
        return null;
      }
      let wall = wallClock(after, fmt);
      for (let month = 0; month < 3; month++) {
        const last = new Date(Date.UTC(wall.year, wall.month, 0)).getUTCDate();
        const days = [...new Set(timing.days)]
          .filter((d) => d >= 1 && d <= last)
          .sort((a, b) => a - b);
        for (const day of days) {
          const candidate = epochOf(
            { ...wall, day, hour: clock.hour, minute: clock.minute },
            fmt,
          );
          if (candidate > after) return candidate;
        }
        wall = wallClock(
          epochOf(
            {
              year: wall.year,
              month: wall.month + 1,
              day: 1,
              hour: 0,
              minute: 0,
            },
            fmt,
          ),
          fmt,
        );
      }
      return null;
    }
    default:
      return null;
  }
}
