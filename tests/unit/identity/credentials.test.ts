import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../../../src/domain/identity/credentials";

describe("normalizeEmail", () => {
  it("trims, lower-cases and NFC-normalizes", () => {
    expect(normalizeEmail("  Ada@Example.TEST ")).toBe("ada@example.test");
    expect(normalizeEmail("josé@example.test")).toBe("josé@example.test");
  });

  it("does not collapse distinct addresses", () => {
    expect(normalizeEmail("a+b@example.test")).toBe("a+b@example.test");
  });
});
