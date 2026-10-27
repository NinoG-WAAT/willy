import { describe, expect, it } from "vitest";
import { normalizeCalendarEvent } from "../../../src/domain/calendar/event";

const valid = {
  provider: "google",
  providerEventId: "evt_1",
  title: "  Weekly   sync ",
  startsAt: "2026-11-03T09:00:00+01:00",
  endsAt: "2026-11-03T09:30:00+01:00",
  timezone: "Europe/Paris",
  attendees: [
    { name: " Ada  Lovelace ", email: "ADA@Example.com " },
    { name: "Grace", email: null },
  ],
};

describe("normalizeCalendarEvent", () => {
  it("trims, collapses whitespace, lowercases emails and stores instants as UTC", () => {
    const result = normalizeCalendarEvent(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        provider: "google",
        providerEventId: "evt_1",
        title: "Weekly sync",
        startsAt: "2026-11-03T08:00:00.000Z",
        endsAt: "2026-11-03T08:30:00.000Z",
        timezone: "Europe/Paris",
        attendees: [
          { name: "Ada Lovelace", email: "ada@example.com" },
          { name: "Grace", email: null },
        ],
      },
    });
  });

  it("normalizes to NFC", () => {
    const result = normalizeCalendarEvent({ ...valid, title: "Café" });
    expect(result.ok && result.value.title).toBe("Café");
  });

  it("falls back to the email as the name but never invents an attendee", () => {
    const result = normalizeCalendarEvent({
      ...valid,
      attendees: [
        { name: "", email: "bob@example.com" },
        { name: "  ", email: null },
      ],
    });
    expect(result.ok && result.value.attendees).toEqual([
      { name: "bob@example.com", email: "bob@example.com" },
    ]);
  });

  it("de-duplicates attendees by email", () => {
    const result = normalizeCalendarEvent({
      ...valid,
      attendees: [
        { name: "A", email: "a@example.com" },
        { name: "A again", email: "A@example.com" },
      ],
    });
    expect(result.ok && result.value.attendees).toHaveLength(1);
  });

  it.each([
    ["empty title", { title: "   " }, "title"],
    ["overlong title", { title: "x".repeat(201) }, "title"],
    ["missing provider event id", { providerEventId: "" }, "providerEventId"],
    ["unknown timezone", { timezone: "Mars/Olympus" }, "timezone"],
    ["unparseable start", { startsAt: "tomorrow" }, "startsAt"],
    ["start without offset", { startsAt: "2026-11-03T09:00:00" }, "startsAt"],
    ["end before start", { endsAt: "2026-11-03T08:00:00+01:00" }, "endsAt"],
    ["bad email", { attendees: [{ name: "x", email: "not-an-email" }] }, "attendees"],
    [
      "too many attendees",
      {
        attendees: Array.from({ length: 101 }, (_, i) => ({
          name: `p${String(i)}`,
          email: `p${String(i)}@example.com`,
        })),
      },
      "attendees",
    ],
    [
      "overlong attendee name",
      { attendees: [{ name: "n".repeat(101), email: null }] },
      "attendees",
    ],
  ])("rejects %s", (_label, patch, field) => {
    const result = normalizeCalendarEvent({ ...valid, ...patch });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.field).toBe(field);
  });

  it("rejects unknown fields and non-objects", () => {
    expect(normalizeCalendarEvent({ ...valid, ownerId: "other" }).ok).toBe(false);
    expect(normalizeCalendarEvent(null).ok).toBe(false);
    expect(normalizeCalendarEvent("event").ok).toBe(false);
  });
});
