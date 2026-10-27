import { describe, expect, it } from "vitest";
import { createCaptureLogger, createJsonLogger } from "../../../src/adapters/logging/json-logger";

function build(base: Record<string, string> = {}) {
  const lines: string[] = [];
  const logger = createJsonLogger(
    (line) => {
      lines.push(line);
    },
    () => new Date("2026-10-27T10:00:00.000Z"),
    base,
  );
  const last = () => JSON.parse(lines[lines.length - 1] ?? "{}") as Record<string, unknown>;
  return { logger, lines, last };
}

describe("json logger", () => {
  it("writes one structured JSON line per event with level, timestamp and fields", () => {
    const { logger, lines, last } = build();
    logger.info("job.finished", { jobId: "j1", attempts: 2, ok: true, nextRunAt: null });
    expect(lines).toHaveLength(1);
    expect(last()).toEqual({
      ts: "2026-10-27T10:00:00.000Z",
      level: "info",
      event: "job.finished",
      jobId: "j1",
      attempts: 2,
      ok: true,
      nextRunAt: null,
    });
  });

  it("supports warn and error levels", () => {
    const { logger, last } = build();
    logger.warn("a");
    expect(last()["level"]).toBe("warn");
    logger.error("b");
    expect(last()["level"]).toBe("error");
  });

  it("carries correlation ids from child loggers on every line", () => {
    const { logger, last } = build({ service: "willy" });
    const child = logger.child({ jobId: "j9", correlationId: "c1" });
    child.info("step", { chunkSeq: 3 });
    expect(last()).toMatchObject({
      service: "willy",
      jobId: "j9",
      correlationId: "c1",
      chunkSeq: 3,
    });
  });

  it.each([
    "password",
    "Authorization",
    "cookie",
    "csrfToken",
    "sessionToken",
    "apiKey",
    "secret",
    "text",
    "transcript",
    "audio",
    "body",
    "email",
    "noteText",
  ])("redacts the sensitive field %s", (key) => {
    const { logger, last } = build();
    logger.info("x", { [key]: "super-sensitive-value" });
    expect(last()[key]).toBe("[redacted]");
    expect(JSON.stringify(last())).not.toContain("super-sensitive-value");
  });

  it("keeps ids and sizes", () => {
    const { logger, last } = build();
    logger.info("x", { meetingId: "m1", ownerId: "o1", bytes: 1024, chunkSeq: 2 });
    expect(last()).toMatchObject({ meetingId: "m1", ownerId: "o1", bytes: 1024, chunkSeq: 2 });
  });

  it("truncates very long values so a stray message cannot dump content", () => {
    const { logger, last } = build();
    logger.info("x", { detail: "a".repeat(5000) });
    expect(String(last()["detail"]).length).toBeLessThanOrEqual(300);
  });

  it("cannot be broken or forged by newlines or reserved keys in fields", () => {
    const { logger, lines, last } = build();
    logger.info("x", {
      detail: 'line1\n{"level":"error","event":"forged"}',
      level: "error",
      ts: "1999",
    });
    expect(lines).toHaveLength(1);
    expect(last()["level"]).toBe("info");
    expect(last()["ts"]).toBe("2026-10-27T10:00:00.000Z");
    expect(last()["event"]).toBe("x");
  });
});

describe("capture logger (test double)", () => {
  it("records entries with merged child fields, applying the same redaction", () => {
    const logger = createCaptureLogger();
    logger.child({ jobId: "j1" }).warn("retrying", { attempts: 2, text: "secret words" });
    expect(logger.entries).toEqual([
      { level: "warn", event: "retrying", jobId: "j1", attempts: 2, text: "[redacted]" },
    ]);
  });
});
