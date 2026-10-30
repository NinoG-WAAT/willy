import { describe, expect, it } from "vitest";
import { NAV_LINKS, currentNavHref, shellFolderState } from "../../src/components/nav-current";

describe("currentNavHref", () => {
  it("marks the exact page", () => {
    expect(currentNavHref("/search")).toBe("/search");
    expect(currentNavHref("/settings")).toBe("/settings");
    expect(currentNavHref("/")).toBe("/");
  });

  it("marks the section a nested page belongs to, preferring the longest match", () => {
    expect(currentNavHref("/settings/templates/new")).toBe("/settings/templates");
    expect(currentNavHref("/folders")).toBe("/folders");
    expect(currentNavHref("/folders/folder-1")).toBe("/folders");
    expect(currentNavHref("/folders/folder-1/delete")).toBe("/folders");
    expect(currentNavHref("/settings/deletions/x")).toBe("/settings");
  });

  it("marks All notes for its page", () => {
    expect(currentNavHref("/notes")).toBe("/notes");
    expect(currentNavHref("/notes/")).toBe("/notes");
    expect(currentNavHref("/notesx")).toBeNull();
  });

  it("files meeting pages under the Inbox", () => {
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

  it("lists every navigation link once, in the order of the shell", () => {
    expect(NAV_LINKS.map((l) => l.href)).toEqual([
      "/",
      "/notes",
      "/search",
      "/folders",
      "/settings/templates",
      "/settings",
    ]);
  });

  it("calls the first item Inbox and offers All notes next to it", () => {
    expect(NAV_LINKS.map((l) => l.label)).toEqual([
      "Inbox",
      "All notes",
      "Search",
      "Folders",
      "Templates",
      "Settings",
    ]);
  });
});

describe("shellFolderState", () => {
  it("marks the folder whose page is open as the current page", () => {
    expect(shellFolderState("/folders/f1")).toEqual({ id: "f1", current: "page" });
    expect(shellFolderState("/folders/f1/")).toEqual({ id: "f1", current: "page" });
  });

  it("keeps the folder active, but not as the page, on its sub-pages", () => {
    expect(shellFolderState("/folders/f1/delete")).toEqual({ id: "f1", current: "true" });
  });

  it("takes the folder of a filed note when the page knows it", () => {
    expect(shellFolderState("/meetings/m1/review", "f9")).toEqual({ id: "f9", current: "true" });
  });

  it("lets the path win over a note's folder", () => {
    expect(shellFolderState("/folders/f1", "f9")).toEqual({ id: "f1", current: "page" });
  });

  it("marks no folder on the index, on other pages or without a known folder", () => {
    expect(shellFolderState("/folders")).toBeNull();
    expect(shellFolderState("/folders/")).toBeNull();
    expect(shellFolderState("/")).toBeNull();
    expect(shellFolderState("/meetings/m1/review")).toBeNull();
    expect(shellFolderState("/meetings/m1/review", null)).toBeNull();
    expect(shellFolderState("/search", "")).toBeNull();
  });

  it("does not match a path that merely shares the prefix", () => {
    expect(shellFolderState("/foldersx/f1")).toBeNull();
  });
});
