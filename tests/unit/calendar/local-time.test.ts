import { describe, expect, it } from "vitest";
import { localToUtc } from "../../../src/domain/calendar/local-time";

const at = (zone: string, y: number, mo: number, d: number, h: number, mi = 0) =>
  localToUtc(zone, { year: y, month: mo, day: d, hour: h, minute: mi, second: 0 });

describe("localToUtc", () => {
  it("applies the winter and the summer offset", () => {
    expect(at("Europe/Paris", 2026, 11, 3, 9)).toBe("2026-11-03T08:00:00.000Z");
    expect(at("Europe/Paris", 2026, 7, 1, 9)).toBe("2026-07-01T07:00:00.000Z");
  });

  it("handles UTC and zones with half-hour offsets", () => {
    expect(at("UTC", 2026, 11, 3, 9)).toBe("2026-11-03T09:00:00.000Z");
    expect(at("Asia/Kolkata", 2026, 11, 3, 9)).toBe("2026-11-03T03:30:00.000Z");
  });

  it("moves across the date line", () => {
    expect(at("Pacific/Kiritimati", 2026, 11, 3, 1)).toBe("2026-11-02T11:00:00.000Z");
    expect(at("America/Los_Angeles", 2026, 12, 31, 23, 30)).toBe("2027-01-01T07:30:00.000Z");
  });

  describe("DST edges", () => {
    it("spring forward: a time that does not exist uses the offset before the gap (RFC 5545)", () => {
      // Paris 2026-03-29: 02:00 CET jumps to 03:00 CEST. 02:30 does not exist.
      expect(at("Europe/Paris", 2026, 3, 29, 2, 30)).toBe("2026-03-29T01:30:00.000Z");
      // New York 2026-03-08: 02:00 EST jumps to 03:00 EDT.
      expect(at("America/New_York", 2026, 3, 8, 2, 30)).toBe("2026-03-08T07:30:00.000Z");
      // Sydney 2026-10-04: 02:00 AEST jumps to 03:00 AEDT (southern hemisphere).
      expect(at("Australia/Sydney", 2026, 10, 4, 2, 30)).toBe("2026-10-03T16:30:00.000Z");
    });

    it("the minute before and the minute after the gap are one real minute apart", () => {
      expect(at("Europe/Paris", 2026, 3, 29, 1, 59)).toBe("2026-03-29T00:59:00.000Z");
      expect(at("Europe/Paris", 2026, 3, 29, 3, 0)).toBe("2026-03-29T01:00:00.000Z");
    });

    it("fall back: an ambiguous time is the first occurrence (RFC 5545)", () => {
      // Paris 2026-10-25: 03:00 CEST falls back to 02:00 CET, so 02:30 happens twice.
      expect(at("Europe/Paris", 2026, 10, 25, 2, 30)).toBe("2026-10-25T00:30:00.000Z");
      // New York 2026-11-01: 02:00 EDT falls back to 01:00 EST, so 01:30 happens twice.
      expect(at("America/New_York", 2026, 11, 1, 1, 30)).toBe("2026-11-01T05:30:00.000Z");
    });

    it("times either side of the fall-back overlap are unambiguous", () => {
      expect(at("Europe/Paris", 2026, 10, 25, 1, 59)).toBe("2026-10-24T23:59:00.000Z");
      expect(at("Europe/Paris", 2026, 10, 25, 3, 0)).toBe("2026-10-25T02:00:00.000Z");
    });

    it("a meeting that spans the change keeps its real length", () => {
      const start = Date.parse(at("Europe/Paris", 2026, 10, 24, 23) ?? "");
      const end = Date.parse(at("Europe/Paris", 2026, 10, 25, 3) ?? "");
      expect((end - start) / 3_600_000).toBe(5);
    });
  });

  it("rejects a date that does not exist", () => {
    expect(at("Europe/Paris", 2026, 2, 30, 9)).toBeNull();
    expect(at("Europe/Paris", 2026, 13, 1, 9)).toBeNull();
    expect(at("Europe/Paris", 2026, 11, 3, 24)).toBeNull();
  });

  it("rejects an unknown zone", () => {
    expect(at("Not/AZone", 2026, 11, 3, 9)).toBeNull();
  });
});
