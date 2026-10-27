import { describe, expect, it } from "vitest";
import { safeNextPath } from "../../../src/domain/identity/next-path";

describe("safeNextPath (open redirect protection)", () => {
  it("keeps same-site relative paths with query and hash", () => {
    expect(safeNextPath("/meetings/abc")).toBe("/meetings/abc");
    expect(safeNextPath("/search?q=roadmap&folder=1")).toBe("/search?q=roadmap&folder=1");
    expect(safeNextPath("/meetings/abc/review#seg-3")).toBe("/meetings/abc/review#seg-3");
  });

  it.each([
    "https://evil.example/",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "evil.example",
    "/ok\nSet-Cookie: x=1",
    "/ok\r\nLocation: https://evil.example",
    "/%0d%0aLocation:evil",
    "  //evil.example",
    "/" + "a".repeat(3000),
  ])("falls back to / for %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });

  it("falls back for missing values and never loops back to the auth pages", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("/sign-in?next=/x")).toBe("/");
    expect(safeNextPath("/session-expired")).toBe("/");
    expect(safeNextPath("/signed-out")).toBe("/");
  });
});
