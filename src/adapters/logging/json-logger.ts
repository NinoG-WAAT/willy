import type { LogFields, Logger } from "../../ports/logger";

type Level = "info" | "warn" | "error";

/** Field names whose values must never be logged, whatever a caller passes. */
const SENSITIVE =
  /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|text|transcript|audio|body|email|note|content)/i;
const MAX_VALUE_LENGTH = 300;
const RESERVED = new Set(["ts", "level", "event"]);

function clean(fields: LogFields): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED.has(key) || value === undefined) continue;
    if (SENSITIVE.test(key)) {
      out[key] = "[redacted]";
    } else if (typeof value === "string") {
      out[key] =
        value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…` : value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * One JSON object per line (easy to ship from stdout or Workers logs). `ts`, `level` and `event`
 * cannot be overridden by fields, values are bounded, and sensitive field names are redacted.
 */
export function createJsonLogger(
  write: (line: string) => void,
  now: () => Date,
  base: LogFields = {},
): Logger {
  const emit = (level: Level, event: string, fields: LogFields = {}): void => {
    write(
      JSON.stringify({
        ...clean({ ...base, ...fields }),
        ts: now().toISOString(),
        level,
        event,
      }),
    );
  };
  return {
    info: (event, fields) => {
      emit("info", event, fields);
    },
    warn: (event, fields) => {
      emit("warn", event, fields);
    },
    error: (event, fields) => {
      emit("error", event, fields);
    },
    child: (fields) => createJsonLogger(write, now, { ...base, ...fields }),
  };
}

export interface CaptureLogger extends Logger {
  entries: ({ level: Level; event: string } & Record<string, string | number | boolean | null>)[];
}

/** Test double: keeps entries in memory with the same redaction as the real logger. */
export function createCaptureLogger(
  base: LogFields = {},
  sink?: CaptureLogger["entries"],
): CaptureLogger {
  const entries: CaptureLogger["entries"] = sink ?? [];
  const emit = (level: Level, event: string, fields: LogFields = {}): void => {
    entries.push({ level, event, ...clean({ ...base, ...fields }) });
  };
  return {
    entries,
    info: (event, fields) => {
      emit("info", event, fields);
    },
    warn: (event, fields) => {
      emit("warn", event, fields);
    },
    error: (event, fields) => {
      emit("error", event, fields);
    },
    child: (fields) => createCaptureLogger({ ...base, ...fields }, entries),
  };
}
