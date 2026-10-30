import { describe, expect, it } from "vitest";
import { FOLDER_PAGE_SIZE, pageWindow, parsePage } from "../../../src/domain/notes/folder-view";

describe("parsePage", () => {
  it("reads a positive whole number", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("1")).toBe(1);
  });

  it("falls back to the first page for anything else", () => {
    for (const raw of [null, "", "0", "-2", "1.5", "abc", "2abc", " 2", "NaN", "1e3"]) {
      expect(parsePage(raw), String(raw)).toBe(1);
    }
  });

  it("caps absurd values so no huge offset reaches the database", () => {
    expect(parsePage("99999999999999999999")).toBeLessThanOrEqual(10_000);
  });
});

describe("pageWindow", () => {
  it("is a single page when everything fits", () => {
    expect(pageWindow(0, 1)).toEqual({
      page: 1,
      pageCount: 1,
      offset: 0,
      limit: FOLDER_PAGE_SIZE,
      hasPrevious: false,
      hasNext: false,
    });
    expect(pageWindow(FOLDER_PAGE_SIZE, 1).pageCount).toBe(1);
  });

  it("splits into pages and tells which neighbours exist", () => {
    const second = pageWindow(FOLDER_PAGE_SIZE * 2 + 1, 2);
    expect(second).toMatchObject({
      page: 2,
      pageCount: 3,
      offset: FOLDER_PAGE_SIZE,
      hasPrevious: true,
      hasNext: true,
    });
    expect(pageWindow(FOLDER_PAGE_SIZE * 2 + 1, 3)).toMatchObject({
      offset: FOLDER_PAGE_SIZE * 2,
      hasNext: false,
    });
  });

  it("clamps a page past the end to the last page", () => {
    expect(pageWindow(30, 99)).toMatchObject({ page: 2, offset: FOLDER_PAGE_SIZE });
    expect(pageWindow(0, 5)).toMatchObject({ page: 1, offset: 0 });
  });
});
