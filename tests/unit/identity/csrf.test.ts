import { describe, expect, it } from "vitest";
import { isSameOrigin, requiresCsrf, tokensMatch } from "../../../src/domain/identity/csrf";

describe("tokensMatch", () => {
  it("accepts only identical non-empty tokens", () => {
    expect(tokensMatch("abc123", "abc123")).toBe(true);
    expect(tokensMatch("abc123", "abc124")).toBe(false);
    expect(tokensMatch("abc123", "abc12")).toBe(false);
    expect(tokensMatch("abc123", "")).toBe(false);
    expect(tokensMatch("abc123", null)).toBe(false);
    expect(tokensMatch("abc123", undefined)).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("accepts the exact origin only", () => {
    expect(isSameOrigin("https://app.example", "https://app.example")).toBe(true);
    expect(isSameOrigin("https://evil.example", "https://app.example")).toBe(false);
    expect(isSameOrigin("http://app.example", "https://app.example")).toBe(false);
    expect(isSameOrigin("https://app.example.evil.test", "https://app.example")).toBe(false);
  });

  it("rejects a missing or opaque origin", () => {
    expect(isSameOrigin(null, "https://app.example")).toBe(false);
    expect(isSameOrigin("null", "https://app.example")).toBe(false);
    expect(isSameOrigin("", "https://app.example")).toBe(false);
  });
});

describe("requiresCsrf", () => {
  it("exempts safe methods only", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(requiresCsrf(m)).toBe(false);
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) expect(requiresCsrf(m)).toBe(true);
  });
});
