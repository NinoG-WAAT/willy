import { describe, expect, it } from "vitest";
import {
  NOTE_STATUS_FILTERS,
  notesHref,
  parseNotesFilter,
  statusesOf,
} from "../../../src/domain/notes/notes-filter";

const query = (qs: string): URLSearchParams => new URLSearchParams(qs);

describe("parseNotesFilter", () => {
  it("defaults to every status, no folder, first page", () => {
    expect(parseNotesFilter(query(""))).toEqual({ status: "all", folderId: null, page: null });
  });

  it("reads a known status and a folder id", () => {
    expect(parseNotesFilter(query("status=draft&folder=f1&page=2"))).toEqual({
      status: "draft",
      folderId: "f1",
      page: "2",
    });
  });

  it("treats an unknown or hostile status as All and never throws", () => {
    for (const raw of [
      "",
      "nope",
      "DRAFT",
      "deleted",
      "deleting",
      "review",
      "'; DROP TABLE meeting",
    ]) {
      expect(parseNotesFilter(query(`status=${encodeURIComponent(raw)}`)).status, raw).toBe("all");
    }
  });

  it("ignores an empty or oversized folder id", () => {
    expect(parseNotesFilter(query("folder=")).folderId).toBeNull();
    expect(parseNotesFilter(query(`folder=${"x".repeat(101)}`)).folderId).toBeNull();
    expect(parseNotesFilter(query(`folder=${"x".repeat(100)}`)).folderId).toBe("x".repeat(100));
  });

  it("passes the raw page through for the page window to clamp", () => {
    expect(parseNotesFilter(query("page=abc")).page).toBe("abc");
  });
});

describe("statusesOf", () => {
  it("maps each filter to the meeting statuses it shows; deleting and deleted are never among them", () => {
    expect(statusesOf("all")).toBeNull();
    expect(statusesOf("draft")).toEqual(["review"]);
    expect(statusesOf("published")).toEqual(["published"]);
    expect(statusesOf("archived")).toEqual(["archived"]);
    for (const status of NOTE_STATUS_FILTERS) {
      expect(statusesOf(status) ?? []).not.toContain("deleting");
      expect(statusesOf(status) ?? []).not.toContain("deleted");
    }
  });
});

describe("notesHref", () => {
  it("is /notes with no parameters for the unfiltered first page", () => {
    expect(notesHref({ status: "all", folderId: null })).toBe("/notes");
  });

  it("keeps the other filter when one changes, and encodes values", () => {
    expect(notesHref({ status: "published", folderId: "f 1" })).toBe(
      "/notes?status=published&folder=f%201",
    );
    expect(notesHref({ status: "all", folderId: "f1" }, 3)).toBe("/notes?folder=f1&page=3");
  });

  it("omits page 1", () => {
    expect(notesHref({ status: "draft", folderId: null }, 1)).toBe("/notes?status=draft");
  });
});
