import { describe, expect, it } from "vitest";
import {
  WINDOWS_TO_IANA,
  isIanaZone,
  resolveIcsTimezone,
} from "../../../src/domain/calendar/windows-timezones";

describe("resolveIcsTimezone", () => {
  it("maps the Windows names Outlook writes to IANA zones", () => {
    expect(resolveIcsTimezone("W. Europe Standard Time")).toBe("Europe/Berlin");
    expect(resolveIcsTimezone("Romance Standard Time")).toBe("Europe/Paris");
    expect(resolveIcsTimezone("GMT Standard Time")).toBe("Europe/London");
    expect(resolveIcsTimezone("Eastern Standard Time")).toBe("America/New_York");
    expect(resolveIcsTimezone("Pacific Standard Time")).toBe("America/Los_Angeles");
    expect(resolveIcsTimezone("India Standard Time")).toBe("Asia/Kolkata");
    expect(resolveIcsTimezone("AUS Eastern Standard Time")).toBe("Australia/Sydney");
    expect(resolveIcsTimezone("UTC")).toBe("UTC");
  });

  it("ignores case and surrounding space", () => {
    expect(resolveIcsTimezone("  w. europe standard time ")).toBe("Europe/Berlin");
  });

  it("accepts IANA names as they are (Teams and other clients write them)", () => {
    expect(resolveIcsTimezone("Europe/Paris")).toBe("Europe/Paris");
    expect(resolveIcsTimezone("America/Argentina/Buenos_Aires")).toBe(
      "America/Argentina/Buenos_Aires",
    );
  });

  it("maps the Microsoft UTC marker", () => {
    expect(resolveIcsTimezone("tzone://Microsoft/Utc")).toBe("UTC");
  });

  it("returns null for names it cannot place instead of guessing", () => {
    expect(resolveIcsTimezone("Customized Time Zone")).toBeNull();
    expect(resolveIcsTimezone("(UTC+01:00) Amsterdam, Berlin")).toBeNull();
    expect(resolveIcsTimezone("")).toBeNull();
    expect(resolveIcsTimezone("Mars/Olympus_Mons")).toBeNull();
  });

  it("is not fooled by object prototype keys", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(resolveIcsTimezone(name)).toBeNull();
    }
  });

  it("does not accept absurdly long names", () => {
    expect(resolveIcsTimezone("a".repeat(5000))).toBeNull();
  });
});

describe("the Windows table", () => {
  it("only maps to zones the runtime knows", () => {
    const unknown = Object.entries(WINDOWS_TO_IANA).filter(([, zone]) => !isIanaZone(zone));
    expect(unknown).toEqual([]);
  });

  it("covers the zones a European and North American company uses", () => {
    expect(Object.keys(WINDOWS_TO_IANA).length).toBeGreaterThan(120);
  });
});
