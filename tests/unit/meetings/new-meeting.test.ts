import { describe, expect, it } from "vitest";
import { normalizeNewMeeting, parseAttendeeLines } from "../../../src/domain/meetings/new-meeting";

const valid = {
  title: "  Weekly   sync ",
  date: "2026-11-03",
  time: "09:00",
  timezone: "Europe/Paris",
  durationMinutes: "45",
  agenda: " Roadmap\r\nHiring ",
  attendees: "Ada Lovelace <ADA@example.com>\ngrace@example.com\nAlan",
};

function fieldsOf(result: ReturnType<typeof normalizeNewMeeting>): string[] {
  return result.ok ? [] : result.error.map((e) => e.field);
}

describe("normalizeNewMeeting", () => {
  it("normalizes text, converts local time to UTC and computes the end", () => {
    expect(normalizeNewMeeting(valid)).toEqual({
      ok: true,
      value: {
        title: "Weekly sync",
        startsAt: "2026-11-03T08:00:00.000Z",
        endsAt: "2026-11-03T08:45:00.000Z",
        timezone: "Europe/Paris",
        agenda: "Roadmap\nHiring",
        attendees: [
          { name: "Ada Lovelace", email: "ada@example.com" },
          { name: "grace@example.com", email: "grace@example.com" },
          { name: "Alan", email: null },
        ],
      },
    });
  });

  it("defaults the duration to 30 minutes and an empty agenda to null", () => {
    const result = normalizeNewMeeting({
      ...valid,
      durationMinutes: "",
      agenda: "  ",
      attendees: "",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { endsAt: "2026-11-03T08:30:00.000Z", agenda: null, attendees: [] },
    });
  });

  it("reports every problem at once with the field it belongs to", () => {
    const result = normalizeNewMeeting({
      title: " ",
      date: "nope",
      time: "99:99",
      timezone: "Mars/Olympus",
      durationMinutes: "0",
      agenda: "a".repeat(2001),
      attendees: "bad <not-an-email>",
    });
    expect(fieldsOf(result)).toEqual(
      expect.arrayContaining([
        "title",
        "date",
        "time",
        "timezone",
        "duration",
        "agenda",
        "attendees",
      ]),
    );
  });

  it.each([
    ["title too long", { title: "t".repeat(201) }, "title"],
    ["duration not a number", { durationMinutes: "abc" }, "duration"],
    ["duration too long", { durationMinutes: "481" }, "duration"],
    [
      "nonexistent local time",
      { date: "2026-03-08", time: "02:30", timezone: "America/New_York" },
      "time",
    ],
    [
      "too many attendees",
      { attendees: Array.from({ length: 101 }, (_, i) => `p${String(i)}@example.com`).join("\n") },
      "attendees",
    ],
  ])("rejects %s", (_label, patch, field) => {
    expect(fieldsOf(normalizeNewMeeting({ ...valid, ...patch }))).toContain(field);
  });

  it("keeps markup as plain text", () => {
    const result = normalizeNewMeeting({ ...valid, title: "<script>alert(1)</script>" });
    expect(result.ok && result.value.title).toBe("<script>alert(1)</script>");
  });
});

describe("parseAttendeeLines", () => {
  it("accepts 'Name <email>', a bare email, or a bare name, one per line", () => {
    expect(parseAttendeeLines("Ada <ada@example.com>\n\n  bob@example.com \nCarol")).toEqual([
      { name: "Ada", email: "ada@example.com" },
      { name: "", email: "bob@example.com" },
      { name: "Carol", email: "" },
    ]);
  });
});
