import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../../../src/domain/calendar/event";
import type { ProviderErrorKind } from "../../../src/domain/platform/provider-error";
import type { CalendarSource } from "../../../src/ports/calendar-source";
import { RANGE, makeEvent } from "../../support/calendar-fixtures";

export interface CalendarSourceHarness {
  source: CalendarSource;
  /** Make `ownerId`'s calendar contain exactly these events. */
  seed(ownerId: string, events: CalendarEvent[]): void;
  /** Make the next call fail the way the provider would for `kind`. */
  failNext(kind: ProviderErrorKind): void;
}

/**
 * Shared contract (CLAUDE.md section 5, Liskov): the fake and the real adapter must behave
 * identically from the caller's point of view, including failures.
 */
export function calendarSourceContract(name: string, create: () => CalendarSourceHarness): void {
  describe(`CalendarSource contract: ${name}`, () => {
    it("returns the owner's events inside the range", async () => {
      const h = create();
      h.seed("owner-a", [
        makeEvent("in-range"),
        makeEvent("too-early", {
          startsAt: "2026-10-01T08:00:00.000Z",
          endsAt: "2026-10-01T09:00:00.000Z",
        }),
      ]);
      const result = await h.source.listEvents("owner-a", RANGE);
      expect(result.ok).toBe(true);
      const events = result.ok ? result.value : [];
      expect(events.map((e) => e.providerEventId)).toEqual(["in-range"]);
      expect(events[0]).toMatchObject({
        title: "Meeting in-range",
        startsAt: "2026-11-03T08:00:00.000Z",
        endsAt: "2026-11-03T08:30:00.000Z",
        timezone: "Europe/Paris",
        attendees: [{ name: "Ada Lovelace", email: "ada@example.com" }],
      });
    });

    it("returns an empty list when the calendar is empty", async () => {
      const h = create();
      h.seed("owner-a", []);
      expect(await h.source.listEvents("owner-a", RANGE)).toEqual({ ok: true, value: [] });
    });

    it("never returns another owner's events", async () => {
      const h = create();
      h.seed("owner-a", [makeEvent("a-only")]);
      h.seed("owner-b", [makeEvent("b-only")]);
      const result = await h.source.listEvents("owner-b", RANGE);
      expect(result.ok && result.value.map((e) => e.providerEventId)).toEqual(["b-only"]);
    });

    it.each([
      ["timeout", true],
      ["rate_limited", true],
      ["unavailable", true],
      ["rejected", false],
    ] as const)("normalizes a %s failure (retryable=%s)", async (kind, retryable) => {
      const h = create();
      h.seed("owner-a", [makeEvent("x")]);
      h.failNext(kind);
      const result = await h.source.listEvents("owner-a", RANGE);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.kind).toBe(kind);
      expect(!result.ok && result.error.retryable).toBe(retryable);
    });

    it("recovers on the next call after a transient failure", async () => {
      const h = create();
      h.seed("owner-a", [makeEvent("x")]);
      h.failNext("unavailable");
      await h.source.listEvents("owner-a", RANGE);
      const second = await h.source.listEvents("owner-a", RANGE);
      expect(second.ok).toBe(true);
    });
  });
}
