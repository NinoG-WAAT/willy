import { existsSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTempDataDir } from "../support/temp-data-dir";

describe("createTempDataDir", () => {
  it("creates a fresh, distinct directory on every call", () => {
    const a = createTempDataDir();
    const b = createTempDataDir();
    try {
      expect(a).not.toBe(b);
      expect(existsSync(a)).toBe(true);
      expect(existsSync(b)).toBe(true);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("is exposed to each test file as WILLY_DATA_DIR by the vitest setup", () => {
    const dir = process.env["WILLY_DATA_DIR"];
    expect(dir).toBeTruthy();
    expect(existsSync(dir ?? "")).toBe(true);
  });
});
