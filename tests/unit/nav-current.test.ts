import { describe, expect, it } from "vitest";
import { NAV_LINKS, currentNavHref } from "../../src/components/nav-current";

describe("currentNavHref", () => {
  it("marks the exact page", () => {
    expect(currentNavHref("/search")).toBe("/search");
    expect(currentNavHref("/settings")).toBe("/settings");
    expect(currentNavHref("/")).toBe("/");
  });

  it("marks the section a nested page belongs to, preferring the longest match", () => {
    expect(currentNavHref("/settings/templates/new")).toBe("/settings/templates");
    expect(currentNavHref("/settings/folders/folder-1/delete")).toBe("/settings/folders");
    expect(currentNavHref("/settings/deletions/x")).toBe("/settings");
  });

  it("files meeting pages under Meetings", () => {
    expect(currentNavHref("/meetings/new")).toBe("/");
    expect(currentNavHref("/meetings/abc/review")).toBe("/");
  });

  it("does not match a path that merely shares a prefix", () => {
    expect(currentNavHref("/searching")).toBeNull();
    expect(currentNavHref("/settingsx")).toBeNull();
  });

  it("marks nothing on pages outside the navigation", () => {
    expect(currentNavHref("/sign-in")).toBeNull();
    expect(currentNavHref("/no-such-page")).toBeNull();
  });

  it("lists every navigation link once", () => {
    expect(NAV_LINKS.map((l) => l.href)).toEqual([
      "/",
      "/search",
      "/settings/templates",
      "/settings/folders",
      "/settings",
    ]);
  });
});
