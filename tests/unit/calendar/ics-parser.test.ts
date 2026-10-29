import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICS_LIMITS, parseIcs, type IcsParse } from "../../../src/domain/calendar/ics";

const FLOATING = "Europe/Paris";
const OPTIONS = { floatingZone: FLOATING };

const crlf = (...lines: string[]) => lines.join("\r\n") + "\r\n";

/** A one-event calendar around the given VEVENT body lines. */
function calendar(...eventLines: string[]): string {
  return crlf(
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    ...eventLines,
    "END:VEVENT",
    "END:VCALENDAR",
  );
}

function parsed(text: string, options = OPTIONS): IcsParse {
  const result = parseIcs(text, options);
  if (!result.ok) throw new Error(`rejected: ${result.error.code}`);
  return result.value;
}

function rejection(text: string, options = OPTIONS): string {
  const result = parseIcs(text, options);
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

function first(text: string) {
  const event = parsed(text).events[0];
  if (!event) throw new Error("no event parsed");
  return event;
}

const BASIC = [
  "UID:abc-1",
  "SUMMARY:Planning",
  "DTSTART:20261103T080000Z",
  "DTEND:20261103T090000Z",
];

describe("parseIcs: events", () => {
  it("reads a UTC event into the calendar event shape under provider ics", () => {
    const { event } = first(calendar(...BASIC));
    expect(event).toEqual({
      provider: "ics",
      providerEventId: "abc-1",
      title: "Planning",
      startsAt: "2026-11-03T08:00:00.000Z",
      endsAt: "2026-11-03T09:00:00.000Z",
      timezone: "UTC",
      attendees: [],
    });
  });

  it("maps a Windows time zone name to IANA and converts to UTC", () => {
    const { event } = first(
      calendar(
        "UID:w1",
        "SUMMARY:Sync",
        "DTSTART;TZID=W. Europe Standard Time:20261103T100000",
        "DTEND;TZID=W. Europe Standard Time:20261103T103000",
      ),
    );
    expect(event.timezone).toBe("Europe/Berlin");
    expect(event.startsAt).toBe("2026-11-03T09:00:00.000Z");
    expect(event.endsAt).toBe("2026-11-03T09:30:00.000Z");
  });

  it("uses the summer offset in July and the winter offset in November", () => {
    const july = first(
      calendar(
        "UID:s",
        "SUMMARY:S",
        "DTSTART;TZID=Romance Standard Time:20260701T100000",
        "DTEND;TZID=Romance Standard Time:20260701T110000",
      ),
    );
    expect(july.event.startsAt).toBe("2026-07-01T08:00:00.000Z");
    expect(july.event.timezone).toBe("Europe/Paris");
  });

  it("keeps a meeting that spans the autumn clock change at its real length", () => {
    const { event } = first(
      calendar(
        "UID:dst",
        "SUMMARY:Night",
        "DTSTART;TZID=Romance Standard Time:20261024T230000",
        "DTEND;TZID=Romance Standard Time:20261025T030000",
      ),
    );
    expect(event.startsAt).toBe("2026-10-24T21:00:00.000Z");
    expect(event.endsAt).toBe("2026-10-25T02:00:00.000Z");
  });

  it("handles a nonexistent spring-forward time and an ambiguous autumn time", () => {
    const gap = first(
      calendar(
        "UID:g",
        "SUMMARY:G",
        "DTSTART;TZID=Romance Standard Time:20260329T023000",
        "DTEND;TZID=Romance Standard Time:20260329T033000",
      ),
    );
    expect(gap.event.startsAt).toBe("2026-03-29T01:30:00.000Z");
    const fold = first(
      calendar(
        "UID:f",
        "SUMMARY:F",
        "DTSTART;TZID=Eastern Standard Time:20261101T013000",
        "DTEND;TZID=Eastern Standard Time:20261101T023000",
      ),
    );
    expect(fold.event.startsAt).toBe("2026-11-01T05:30:00.000Z");
  });

  it("accepts an IANA TZID", () => {
    const { event } = first(
      calendar(
        "UID:i",
        "SUMMARY:I",
        "DTSTART;TZID=America/Chicago:20261103T090000",
        "DTEND;TZID=America/Chicago:20261103T100000",
      ),
    );
    expect(event.timezone).toBe("America/Chicago");
    expect(event.startsAt).toBe("2026-11-03T15:00:00.000Z");
  });

  it("reads floating times in the zone the owner chose", () => {
    const { event } = first(
      calendar("UID:fl", "SUMMARY:F", "DTSTART:20261103T090000", "DTEND:20261103T100000"),
    );
    expect(event.timezone).toBe(FLOATING);
    expect(event.startsAt).toBe("2026-11-03T08:00:00.000Z");
  });

  it("treats an all-day event as midnight to midnight in the chosen zone", () => {
    const item = first(
      calendar(
        "UID:ad",
        "SUMMARY:Offsite",
        "DTSTART;VALUE=DATE:20261106",
        "DTEND;VALUE=DATE:20261107",
      ),
    );
    expect(item.allDay).toBe(true);
    expect(item.event.startsAt).toBe("2026-11-05T23:00:00.000Z");
    expect(item.event.endsAt).toBe("2026-11-06T23:00:00.000Z");
  });

  it("gives an all-day event without an end a one-day length", () => {
    const item = first(calendar("UID:ad", "SUMMARY:Offsite", "DTSTART;VALUE=DATE:20261106"));
    expect(item.event.endsAt).toBe("2026-11-06T23:00:00.000Z");
  });

  it("uses DURATION when there is no DTEND", () => {
    const hour = first(
      calendar("UID:d", "SUMMARY:D", "DTSTART:20261103T080000Z", "DURATION:PT1H30M"),
    );
    expect(hour.event.endsAt).toBe("2026-11-03T09:30:00.000Z");
    const day = first(
      calendar("UID:d", "SUMMARY:D", "DTSTART:20261103T080000Z", "DURATION:P1DT2H"),
    );
    expect(day.event.endsAt).toBe("2026-11-04T10:00:00.000Z");
  });

  it("falls back to the new-note default length when nothing says how long", () => {
    const item = first(calendar("UID:n", "SUMMARY:N", "DTSTART:20261103T080000Z"));
    expect(item.event.endsAt).toBe("2026-11-03T08:30:00.000Z");
  });

  it("marks a cancelled event", () => {
    expect(first(calendar(...BASIC, "STATUS:CANCELLED")).cancelled).toBe(true);
    expect(first(calendar(...BASIC, "STATUS:CONFIRMED")).cancelled).toBe(false);
    expect(first(calendar(...BASIC)).cancelled).toBe(false);
  });

  it("marks every event of a METHOD:CANCEL message as cancelled", () => {
    const text = crlf(
      "BEGIN:VCALENDAR",
      "METHOD:CANCEL",
      "BEGIN:VEVENT",
      ...BASIC,
      "END:VEVENT",
      "END:VCALENDAR",
    );
    expect(first(text).cancelled).toBe(true);
  });

  it("gives an event without a summary a neutral title", () => {
    const { event } = first(
      calendar("UID:t", "DTSTART:20261103T080000Z", "DTEND:20261103T090000Z"),
    );
    expect(event.title).toBe("Untitled meeting");
  });

  it("sorts events by start", () => {
    const text = crlf(
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:b",
      "SUMMARY:Later",
      "DTSTART:20261105T080000Z",
      "DTEND:20261105T090000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:a",
      "SUMMARY:Earlier",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    expect(parsed(text).events.map((e) => e.event.title)).toEqual(["Earlier", "Later"]);
  });
});

describe("parseIcs: text handling", () => {
  it("unfolds lines folded with a space or a tab, in CRLF or LF files", () => {
    const folded = [
      "UID:u",
      "SUMMARY:A very long",
      " title that was",
      "\tfolded twice",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
    ];
    expect(first(calendar(...folded)).event.title).toBe("A very longtitle that wasfolded twice");
    const lf =
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\n" + folded.join("\n") + "\nEND:VEVENT\nEND:VCALENDAR\n";
    expect(first(lf).event.title).toBe("A very longtitle that wasfolded twice");
  });

  it("accepts a file with mixed line endings and a missing final newline", () => {
    const text =
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\nUID:m\rSUMMARY:Mixed\r\nDTSTART:20261103T080000Z\nDTEND:20261103T090000Z\r\nEND:VEVENT\nEND:VCALENDAR";
    expect(first(text).event.title).toBe("Mixed");
  });

  it("strips a byte order mark", () => {
    expect(first("﻿" + calendar(...BASIC)).event.title).toBe("Planning");
  });

  it("unescapes commas, semicolons, backslashes and newlines in text values", () => {
    const item = first(
      calendar(
        "UID:e",
        "SUMMARY:Design review\\; v2\\, final",
        "LOCATION:Room 4\\\\5",
        "DESCRIPTION:Line one\\nLine two\\Nthree",
        "DTSTART:20261103T080000Z",
        "DTEND:20261103T090000Z",
      ),
    );
    expect(item.event.title).toBe("Design review; v2, final");
    expect(item.location).toBe("Room 4\\5");
    expect(item.description).toBe("Line one\nLine two\nthree");
  });

  it("keeps HTML and script in a summary as inert text (escaping happens on output)", () => {
    const { event } = first(
      calendar(
        "UID:x",
        "SUMMARY:<script>alert(1)</script><img src=x onerror=alert(2)>",
        "DTSTART:20261103T080000Z",
        "DTEND:20261103T090000Z",
      ),
    );
    expect(event.title).toBe("<script>alert(1)</script><img src=x onerror=alert(2)>");
  });

  it("keeps URLs in the description and location as plain text and creates no link field", () => {
    const item = first(
      calendar(
        "UID:l",
        "SUMMARY:Teams",
        "LOCATION:https://teams.microsoft.com/l/meetup-join/abc",
        "DESCRIPTION:Join: https://teams.microsoft.com/l/meetup-join/abc",
        "X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/abc",
        "URL:https://example.com/x",
        "DTSTART:20261103T080000Z",
        "DTEND:20261103T090000Z",
      ),
    );
    expect(item.description).toBe("Join: https://teams.microsoft.com/l/meetup-join/abc");
    expect(item.location).toBe("https://teams.microsoft.com/l/meetup-join/abc");
    expect(Object.keys(item).sort()).toEqual([
      "allDay",
      "cancelled",
      "description",
      "event",
      "location",
    ]);
    expect(JSON.stringify(item.event)).not.toContain("http");
  });

  it("does not take a description or other property from a nested alarm or a time zone block", () => {
    const text = crlf(
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "TZID:W. Europe Standard Time",
      "BEGIN:STANDARD",
      "DTSTART:16011028T030000",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:v",
      "SUMMARY:Real",
      "DESCRIPTION:Real description",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      "BEGIN:VALARM",
      "DESCRIPTION:Reminder",
      "SUMMARY:Alarm",
      "DTSTART:20200101T000000Z",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    const result = parsed(text);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.event.title).toBe("Real");
    expect(result.events[0]?.description).toBe("Real description");
    expect(result.events[0]?.event.startsAt).toBe("2026-11-03T08:00:00.000Z");
  });

  it("replaces C1 control characters and odd spacing in values", () => {
    const { event } = first(
      calendar(
        "UID:c",
        "SUMMARY:Bell\u0085ring   twice",
        "DTSTART:20261103T080000Z",
        "DTEND:20261103T090000Z",
      ),
    );
    expect(event.title).toBe("Bell ring twice");
  });

  it("copes with quoted parameter values that contain colons, semicolons and commas", () => {
    const item = first(
      calendar(
        ...BASIC,
        'ATTENDEE;CN="Doe; Jane: the, Third";ROLE=REQ-PARTICIPANT:mailto:jane@example.com',
      ),
    );
    expect(item.event.attendees).toEqual([
      { name: "Doe; Jane: the, Third", email: "jane@example.com" },
    ]);
  });
});

describe("parseIcs: attendees", () => {
  it("reads names and emails from ATTENDEE and ORGANIZER and never invents anyone", () => {
    const { event } = first(
      calendar(
        ...BASIC,
        'ORGANIZER;CN="Camille Martin":mailto:Camille.Martin@Example.com',
        'ATTENDEE;CN="Noah Bernard";PARTSTAT=NEEDS-ACTION:mailto:noah@example.com',
      ),
    );
    expect(event.attendees).toEqual([
      { name: "Camille Martin", email: "camille.martin@example.com" },
      { name: "Noah Bernard", email: "noah@example.com" },
    ]);
  });

  it("lists an organizer who is also an attendee once", () => {
    const { event } = first(
      calendar(
        ...BASIC,
        'ORGANIZER;CN="Camille":mailto:c@example.com',
        'ATTENDEE;CN="Camille":mailto:c@example.com',
      ),
    );
    expect(event.attendees).toHaveLength(1);
  });

  it("has no attendees when the event lists none", () => {
    expect(first(calendar(...BASIC)).event.attendees).toEqual([]);
  });

  it("leaves rooms and equipment out: they cannot consent", () => {
    const { event } = first(
      calendar(
        ...BASIC,
        'ATTENDEE;CN="Room Atlas";CUTYPE=RESOURCE:mailto:room@example.com',
        'ATTENDEE;CN="Boardroom";CUTYPE=ROOM:mailto:board@example.com',
        'ATTENDEE;CN="Ana":mailto:ana@example.com',
      ),
    );
    expect(event.attendees).toEqual([{ name: "Ana", email: "ana@example.com" }]);
  });

  it("keeps a name when the address is not an email (Exchange directory paths)", () => {
    const { event } = first(
      calendar(
        ...BASIC,
        'ATTENDEE;CN="Noah Bernard":/O=EXAMPLE/OU=FIRST/CN=RECIPIENTS/CN=NOAH',
        "ATTENDEE:mailto:not-an-email",
      ),
    );
    expect(event.attendees).toEqual([{ name: "Noah Bernard", email: null }]);
  });

  it("uses the email as the name when there is no CN", () => {
    const { event } = first(calendar(...BASIC, "ATTENDEE:mailto:ana@example.com"));
    expect(event.attendees).toEqual([{ name: "ana@example.com", email: "ana@example.com" }]);
  });

  it("collapses thousands of repeated attendees into one", () => {
    const lines = Array.from({ length: 3000 }, () => "ATTENDEE;CN=Ana:mailto:ana@example.com");
    expect(first(calendar(...BASIC, ...lines)).event.attendees).toHaveLength(1);
  });

  it("skips an event with more distinct attendees than a meeting may hold, naming the reason", () => {
    const lines = Array.from(
      { length: 150 },
      (_, i) => `ATTENDEE;CN=P${String(i)}:mailto:p${String(i)}@example.com`,
    );
    const result = parsed(calendar(...BASIC, ...lines));
    expect(result.events).toEqual([]);
    expect(result.skipped).toEqual([{ code: "invalid_event", title: "Planning" }]);
  });
});

describe("parseIcs: stable ids and recurrence", () => {
  it("keys an event by its UID, whatever else changes", () => {
    const a = first(calendar(...BASIC)).event.providerEventId;
    const b = first(
      calendar(
        "UID:abc-1",
        "SUMMARY:Renamed",
        "DTSTART:20261110T080000Z",
        "DTEND:20261110T090000Z",
      ),
    ).event.providerEventId;
    expect(a).toBe("abc-1");
    expect(b).toBe("abc-1");
  });

  it("keys a RECURRENCE-ID override by UID plus the instant it replaces, in UTC", () => {
    const viaZone = first(
      calendar(
        "UID:series",
        "SUMMARY:Moved",
        "RECURRENCE-ID;TZID=W. Europe Standard Time:20261109T090000",
        "DTSTART;TZID=W. Europe Standard Time:20261109T100000",
        "DTEND;TZID=W. Europe Standard Time:20261109T101500",
      ),
    );
    const viaUtc = first(
      calendar(
        "UID:series",
        "SUMMARY:Moved",
        "RECURRENCE-ID:20261109T080000Z",
        "DTSTART:20261109T090000Z",
        "DTEND:20261109T091500Z",
      ),
    );
    expect(viaZone.event.providerEventId).toBe("series|20261109T080000Z");
    expect(viaUtc.event.providerEventId).toBe(viaZone.event.providerEventId);
  });

  it("does not expand a recurring series: it is reported, not imported", () => {
    const text = calendar(
      "UID:r",
      "SUMMARY:Standup",
      "DTSTART:20261102T080000Z",
      "DTEND:20261102T081500Z",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261116T080000Z",
    );
    const result = parsed(text);
    expect(result.events).toEqual([]);
    expect(result.series).toEqual([{ title: "Standup" }]);
  });

  it("also reports a series defined only by RDATE", () => {
    const result = parsed(
      calendar(
        "UID:r",
        "SUMMARY:Odd",
        "DTSTART:20261102T080000Z",
        "DTEND:20261102T081500Z",
        "RDATE:20261201T080000Z",
      ),
    );
    expect(result.series).toEqual([{ title: "Odd" }]);
  });

  it("imports an explicit override while the series master stays out", () => {
    const text = crlf(
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:s",
      "SUMMARY:Standup",
      "DTSTART:20261102T080000Z",
      "DTEND:20261102T081500Z",
      "RRULE:FREQ=WEEKLY",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:s",
      "RECURRENCE-ID:20261109T080000Z",
      "SUMMARY:Standup (moved)",
      "DTSTART:20261109T090000Z",
      "DTEND:20261109T091500Z",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    const result = parsed(text);
    expect(result.events.map((e) => e.event.providerEventId)).toEqual(["s|20261109T080000Z"]);
    expect(result.series).toEqual([{ title: "Standup" }]);
  });
});

describe("parseIcs: events that cannot be imported", () => {
  const skipped = (...lines: string[]) => parsed(calendar(...lines)).skipped;

  it("skips an event without a UID", () => {
    expect(skipped("SUMMARY:No id", "DTSTART:20261103T080000Z")).toEqual([
      { code: "bad_uid", title: "No id" },
    ]);
  });

  it("skips an event without a start but still reads the others", () => {
    const text = crlf(
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:a",
      "SUMMARY:No start",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:b",
      "SUMMARY:Fine",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    const result = parsed(text);
    expect(result.skipped).toEqual([{ code: "missing_start", title: "No start" }]);
    expect(result.events.map((e) => e.event.title)).toEqual(["Fine"]);
  });

  it("skips an unreadable date", () => {
    expect(skipped("UID:a", "SUMMARY:Bad", "DTSTART:20261345T080000Z")).toEqual([
      { code: "bad_start", title: "Bad" },
    ]);
    expect(skipped("UID:a", "SUMMARY:Bad", "DTSTART:tomorrow")).toEqual([
      { code: "bad_start", title: "Bad" },
    ]);
  });

  it("skips an event in a time zone it cannot place rather than guessing", () => {
    expect(
      skipped(
        "UID:a",
        "SUMMARY:Odd zone",
        "DTSTART;TZID=Customized Time Zone:20261103T080000",
        "DTEND;TZID=Customized Time Zone:20261103T090000",
      ),
    ).toEqual([{ code: "unknown_timezone", title: "Odd zone" }]);
  });

  it("skips an event that ends before it starts", () => {
    expect(
      skipped("UID:a", "SUMMARY:Backwards", "DTSTART:20261103T090000Z", "DTEND:20261103T080000Z"),
    ).toEqual([{ code: "end_before_start", title: "Backwards" }]);
  });

  it("skips an event whose title is longer than a meeting title may be", () => {
    expect(
      skipped(
        "UID:a",
        `SUMMARY:${"x".repeat(300)}`,
        "DTSTART:20261103T080000Z",
        "DTEND:20261103T090000Z",
      ),
    ).toEqual([{ code: "invalid_event", title: null }]);
  });

  it("keeps one of two events with the same UID (higher SEQUENCE wins) and reports the other", () => {
    const text = crlf(
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:dup",
      "SEQUENCE:1",
      "SUMMARY:Newer",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:dup",
      "SEQUENCE:0",
      "SUMMARY:Older",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    const result = parsed(text);
    expect(result.events.map((e) => e.event.title)).toEqual(["Newer"]);
    expect(result.skipped).toEqual([{ code: "duplicate", title: "Older" }]);
  });

  it("lets the later of two equal-SEQUENCE duplicates win", () => {
    const text = crlf(
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:dup",
      "SUMMARY:First",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:dup",
      "SUMMARY:Second",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    expect(parsed(text).events.map((e) => e.event.title)).toEqual(["Second"]);
  });

  it("skips a UID too long to be a stable id", () => {
    expect(
      skipped(`UID:${"u".repeat(300)}`, "SUMMARY:Long uid", "DTSTART:20261103T080000Z"),
    ).toEqual([{ code: "bad_uid", title: "Long uid" }]);
  });
});

describe("parseIcs: files it refuses", () => {
  it("refuses empty input", () => {
    expect(rejection("")).toBe("empty");
    expect(rejection("  \r\n \n")).toBe("empty");
  });

  it("refuses text that is not a calendar", () => {
    expect(rejection("%PDF-1.7 binary-ish")).toBe("not_ics");
    expect(rejection("<html><body>hi</body></html>")).toBe("not_ics");
    expect(rejection("just some notes")).toBe("not_ics");
  });

  it("refuses NUL bytes and other binary control characters", () => {
    expect(rejection(calendar(...BASIC) + "\u0000")).toBe("invalid_characters");
    expect(rejection(calendar(...BASIC).replace("Planning", "Plan\u0001ning"))).toBe(
      "invalid_characters",
    );
  });

  it("refuses a calendar that is not closed", () => {
    expect(rejection(crlf("BEGIN:VCALENDAR", "BEGIN:VEVENT", ...BASIC, "END:VEVENT"))).toBe(
      "malformed",
    );
    expect(rejection(crlf("BEGIN:VCALENDAR", "BEGIN:VEVENT", ...BASIC, "END:VCALENDAR"))).toBe(
      "malformed",
    );
    expect(rejection(crlf("BEGIN:VCALENDAR", "END:VEVENT", "END:VCALENDAR"))).toBe("malformed");
  });

  it("refuses a calendar without events", () => {
    expect(rejection(crlf("BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"))).toBe("no_events");
  });

  it("refuses a time zone it was not given", () => {
    expect(rejection(calendar(...BASIC), { floatingZone: "Not/AZone" })).toBe("bad_zone");
  });
});

describe("parseIcs: hostile input", () => {
  const events = (n: number) =>
    crlf(
      "BEGIN:VCALENDAR",
      ...Array.from({ length: n }, (_, i) => [
        `BEGIN:VEVENT`,
        `UID:e${String(i)}`,
        "SUMMARY:E",
        "DTSTART:20261103T080000Z",
        "DTEND:20261103T090000Z",
        "END:VEVENT",
      ]).flat(),
      "END:VCALENDAR",
    );

  it("accepts exactly the maximum number of events and refuses one more (never truncates)", () => {
    expect(parsed(events(ICS_LIMITS.maxEvents)).events).toHaveLength(ICS_LIMITS.maxEvents);
    expect(rejection(events(ICS_LIMITS.maxEvents + 1))).toBe("too_many_events");
  });

  it("refuses a file over the size limit", () => {
    const huge = calendar(...BASIC, "DESCRIPTION:" + "a".repeat(ICS_LIMITS.maxBytes));
    expect(rejection(huge)).toBe("too_large");
  });

  it("refuses an unfolded line over the line limit", () => {
    expect(
      rejection(calendar(...BASIC, "DESCRIPTION:" + "a".repeat(ICS_LIMITS.maxLineLength + 1))),
    ).toBe("line_too_long");
  });

  it("refuses deeply folded lines quickly: a line built from many tiny folds", () => {
    const pieces = Array.from({ length: 40_000 }, () => " ab");
    const text = calendar(...BASIC, "DESCRIPTION:x", ...pieces);
    const started = performance.now();
    expect(rejection(text)).toBe("line_too_long");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("refuses more physical lines than the limit", () => {
    const text = calendar(...BASIC, ...Array.from({ length: ICS_LIMITS.maxLines }, () => "X-A:b"));
    expect(rejection(text)).toBe("too_many_lines");
  });

  it("refuses absurd nesting", () => {
    const open = Array.from({ length: 30 }, () => "BEGIN:VX");
    const close = Array.from({ length: 30 }, () => "END:VX");
    expect(rejection(crlf("BEGIN:VCALENDAR", ...open, ...close, "END:VCALENDAR"))).toBe("too_deep");
  });

  it("parses pathological parameter strings in linear time (no regex backtracking)", () => {
    const attacks = [
      "ATTENDEE;" + "a=b;".repeat(10_000) + ":mailto:x@example.com",
      'ATTENDEE;CN="' + 'a\\"'.repeat(15_000) + ":mailto:x@example.com",
      "DESCRIPTION:" + "\\".repeat(60_000),
      "SUMMARY:" + "\\n".repeat(30_000),
      "ATTENDEE;CN=" + ";".repeat(60_000),
      "DTSTART;TZID=" + "W. ".repeat(10_000) + ":20261103T080000",
    ];
    for (const line of attacks) {
      const started = performance.now();
      parseIcs(
        calendar("UID:r", "SUMMARY:R", "DTSTART:20261103T080000Z", "DTEND:20261103T090000Z", line),
        OPTIONS,
      );
      expect(performance.now() - started, line.slice(0, 30)).toBeLessThan(500);
    }
  });

  it("stays bounded for billion-laughs-style repetition: 200 events each repeating the same attendee", () => {
    const attendee = "ATTENDEE;CN=Ana:mailto:ana@example.com";
    const one = [
      "BEGIN:VEVENT",
      "UID:%",
      "SUMMARY:Rep",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      ...Array.from({ length: 40 }, () => attendee),
      "END:VEVENT",
    ];
    const text = crlf(
      "BEGIN:VCALENDAR",
      ...Array.from({ length: 200 }, (_, i) => one.map((l) => l.replace("%", String(i)))).flat(),
      "END:VCALENDAR",
    );
    const started = performance.now();
    const result = parsed(text);
    expect(result.events).toHaveLength(200);
    expect(result.events.every((e) => e.event.attendees.length === 1)).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("is deterministic: the same text always gives the same result", () => {
    const text = readFileSync(join(__dirname, "../../fixtures/ics/outlook-week.ics"), "utf8");
    expect(parseIcs(text, OPTIONS)).toEqual(parseIcs(text, OPTIONS));
  });
});

describe("parseIcs: Outlook export fixture", () => {
  const text = readFileSync(join(__dirname, "../../fixtures/ics/outlook-week.ics"), "utf8");
  const result = parsed(text);
  const byTitle = (title: string) => result.events.find((e) => e.event.title === title);

  it("reads the importable events, sorted, with the right instants", () => {
    expect(result.events.map((e) => e.event.title)).toEqual([
      "Product sync",
      "Design review; v2, final",
      "Canceled: Budget review",
      "Investor update call",
      "Company offsite",
      "Team standup (moved)",
    ]);
    expect(byTitle("Product sync")?.event).toMatchObject({
      timezone: "Europe/Berlin",
      startsAt: "2026-11-03T09:00:00.000Z",
      endsAt: "2026-11-03T09:30:00.000Z",
    });
    expect(byTitle("Design review; v2, final")?.event).toMatchObject({
      timezone: "America/New_York",
      startsAt: "2026-11-04T20:00:00.000Z",
    });
    expect(byTitle("Investor update call")?.event).toMatchObject({
      timezone: "UTC",
      startsAt: "2026-11-05T15:00:00.000Z",
    });
  });

  it("flags the all-day and the cancelled events", () => {
    expect(byTitle("Company offsite")?.allDay).toBe(true);
    expect(byTitle("Canceled: Budget review")?.cancelled).toBe(true);
    expect(byTitle("Product sync")?.cancelled).toBe(false);
  });

  it("keeps the Teams join link as plain description text, unfolded", () => {
    const description = byTitle("Product sync")?.description ?? "";
    expect(description).toContain("Microsoft Teams meeting");
    expect(description).toContain(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_EXAMPLEEXAMPLE%40thread.v2/0?context=%7b%22Tid%22%3a%22example%22%7d",
    );
    expect(description).toContain("Agenda: roadmap, pricing; hiring.");
  });

  it("lists people only from ORGANIZER and ATTENDEE, leaving the room out", () => {
    expect(byTitle("Product sync")?.event.attendees).toEqual([
      { name: "Camille Martin", email: "camille.martin@example.com" },
      { name: "Noah Bernard", email: "noah.bernard@example.com" },
    ]);
    expect(byTitle("Company offsite")?.event.attendees).toEqual([]);
  });

  it("reports the weekly series without expanding it and imports the explicit override", () => {
    expect(result.series).toEqual([{ title: "Team standup" }]);
    expect(byTitle("Team standup (moved)")?.event.providerEventId).toMatch(/\|20261109T080000Z$/);
    expect(byTitle("Team standup (moved)")?.event.startsAt).toBe("2026-11-09T09:00:00.000Z");
    expect(result.skipped).toEqual([]);
  });
});
