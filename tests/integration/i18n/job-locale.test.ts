import { describe, expect, it } from "vitest";
import { withOwnerLocale } from "../../../src/adapters/i18n/job-locale";
import { createCaptureLogger } from "../../../src/adapters/logging/json-logger";
import type { JobHandler } from "../../../src/app/jobs/runner";
import type { JobRow } from "../../../src/ports/job-repository";
import type { LanguageRepository } from "../../../src/ports/language-repository";
import { currentLocale, type Locale } from "../../../src/i18n/translate";
import { inLocale } from "../../support/locale";

const job = (ownerId: string): JobRow => ({
  id: "j1",
  ownerId,
  meetingId: "m1",
  kind: "summarize",
  jobKey: "summarize:m1:1",
  status: "running",
  attempts: 1,
  maxAttempts: 5,
  nextRunAt: null,
  lastErrorCode: null,
  payload: {},
  updatedAt: "2026-10-27T10:00:00.000Z",
});

/** Stands in for `settings.language`: the owners we know and what they chose. */
const languages = (choices: Record<string, Locale | null>): LanguageRepository => ({
  get: (ownerId) => Promise.resolve(choices[ownerId] ?? null),
  save: () => Promise.resolve(),
});

/** A handler that records which locale `t()` sees while it runs, after an await. */
function spy(): { handler: JobHandler; seen: Locale[] } {
  const seen: Locale[] = [];
  return {
    seen,
    handler: {
      kind: "summarize",
      run: async () => {
        await Promise.resolve();
        seen.push(currentLocale());
        return { kind: "succeeded" };
      },
    },
  };
}

describe("withOwnerLocale: jobs write in the owner's language (issue #122)", () => {
  const logger = createCaptureLogger();

  it("runs the job in the owner's chosen language, whatever the server default", async () => {
    const { handler, seen } = spy();
    const wrapped = withOwnerLocale(handler, languages({ A: "fr", B: "en" }));
    await inLocale("en", () => wrapped.run(job("A"), logger));
    await inLocale("fr", () => wrapped.run(job("B"), logger));
    expect(seen).toEqual(["fr", "en"]);
  });

  it("uses the server default for an owner who has not chosen", async () => {
    const { handler, seen } = spy();
    const wrapped = withOwnerLocale(handler, languages({ A: null }));
    await inLocale("fr", () => wrapped.run(job("A"), logger));
    expect(seen).toEqual(["fr"]);
  });

  it("keeps the handler's kind and result untouched", async () => {
    const wrapped = withOwnerLocale(spy().handler, languages({ A: "fr" }));
    expect(wrapped.kind).toBe("summarize");
    expect(await wrapped.run(job("A"), logger)).toEqual({ kind: "succeeded" });
  });

  it("never blocks the job when the language cannot be read: default locale, one warning without owner data", async () => {
    const { handler, seen } = spy();
    const failing: LanguageRepository = {
      get: () => Promise.reject(new Error("db down, owner secret@example.test")),
      save: () => Promise.resolve(),
    };
    const log = createCaptureLogger();
    await inLocale("en", () => withOwnerLocale(handler, failing).run(job("A"), log));
    expect(seen).toEqual(["en"]);
    expect(log.entries).toEqual([
      expect.objectContaining({ level: "warn", event: "i18n.locale_unavailable" }),
    ]);
    expect(JSON.stringify(log.entries)).not.toContain("secret@example.test");
  });

  it("does not leak one owner's language into the next job", async () => {
    const { handler, seen } = spy();
    const wrapped = withOwnerLocale(handler, languages({ A: "fr", B: "en" }));
    await inLocale("en", () =>
      Promise.all([wrapped.run(job("A"), logger), wrapped.run(job("B"), logger)]),
    );
    expect(seen.sort()).toEqual(["en", "fr"]);
    expect(currentLocale()).toBe("en");
  });
});
