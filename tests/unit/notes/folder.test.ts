import { describe, expect, it } from "vitest";
import {
  FOLDER_NAME_MAX,
  canDeleteFolder,
  normalizeFolderName,
} from "../../../src/domain/notes/folder";

describe("normalizeFolderName", () => {
  it("normalizes a valid name", () => {
    expect(normalizeFolderName("  Board   updates ")).toEqual({ ok: true, value: "Board updates" });
  });

  it("requires a name", () => {
    expect(normalizeFolderName("   ")).toMatchObject({ ok: false, error: { field: "name" } });
    expect(normalizeFolderName(undefined)).toMatchObject({ ok: false, error: { field: "name" } });
  });

  it("limits the length after normalization", () => {
    expect(normalizeFolderName("x".repeat(FOLDER_NAME_MAX)).ok).toBe(true);
    const tooLong = normalizeFolderName("x".repeat(FOLDER_NAME_MAX + 1));
    expect(tooLong).toMatchObject({ ok: false, error: { field: "name" } });
  });
});

describe("canDeleteFolder", () => {
  it("only allows deleting an empty folder (default policy: blocked, never silently moving notes)", () => {
    expect(canDeleteFolder(0)).toBe(true);
    expect(canDeleteFolder(1)).toBe(false);
  });
});
