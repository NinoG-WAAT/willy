import { describe, expect, it } from "vitest";
import { ICS_LIMITS } from "../../../src/domain/calendar/ics";
import { checkBodyLength, maxBodyBytesFor } from "../../../src/app/ops/body-limits";

describe("maxBodyBytesFor", () => {
  it("bounds the two ICS import posts, which carry a whole calendar", () => {
    expect(maxBodyBytesFor("POST", "/meetings/import/ics")).toBeGreaterThan(ICS_LIMITS.maxBytes);
    expect(maxBodyBytesFor("POST", "/meetings/import/ics/confirm")).toBeGreaterThan(
      ICS_LIMITS.maxBytes,
    );
  });

  it("leaves every other route to its own handling", () => {
    expect(maxBodyBytesFor("GET", "/meetings/import/ics")).toBeNull();
    expect(maxBodyBytesFor("POST", "/meetings/import")).toBeNull();
    expect(maxBodyBytesFor("POST", "/meetings/import/ics/x")).toBeNull();
    expect(maxBodyBytesFor("POST", "/sign-in")).toBeNull();
  });
});

describe("checkBodyLength", () => {
  it("accepts a declared length within the limit", () => {
    expect(checkBodyLength("1000", 4096)).toBeNull();
    expect(checkBodyLength("4096", 4096)).toBeNull();
  });

  it("answers 413 when the declared length is over the limit", () => {
    expect(checkBodyLength("4097", 4096)).toBe(413);
    expect(checkBodyLength("99999999999999999999", 4096)).toBe(413);
  });

  it("answers 411 when the length is missing or not a plain number (chunked or forged)", () => {
    expect(checkBodyLength(null, 4096)).toBe(411);
    expect(checkBodyLength("", 4096)).toBe(411);
    expect(checkBodyLength("-1", 4096)).toBe(411);
    expect(checkBodyLength("12abc", 4096)).toBe(411);
    expect(checkBodyLength("1e3", 4096)).toBe(411);
  });
});
