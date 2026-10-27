import { describe, expect, it } from "vitest";
import { handleSaveNotes } from "../../../src/app/meetings/notes-http";
import { MAX_ROUGH_NOTES_CHARS } from "../../../src/domain/meetings/rough-notes";
import { err, ok } from "../../../src/domain/platform/result";

const saved = ok({ savedAt: "2026-10-27T10:00:00.000Z" });

describe("handleSaveNotes (autosave endpoint)", () => {
  it("saves the posted notes for the session's owner and meeting", async () => {
    const calls: unknown[] = [];
    const result = await handleSaveNotes(
      (ownerId, meetingId, raw) => {
        calls.push([ownerId, meetingId, raw]);
        return Promise.resolve(saved);
      },
      {
        ownerId: "A",
        meetingId: "m1",
        contentType: "application/json",
        body: '{"roughNotes":"hi"}',
      },
    );
    expect(result).toEqual({ status: 200, body: { savedAt: "2026-10-27T10:00:00.000Z" } });
    expect(calls).toEqual([["A", "m1", "hi"]]);
  });

  it.each([
    ["not json", "{nope"],
    ["wrong shape", '{"notes":"x"}'],
    ["extra fields (an owner id must never be accepted)", '{"roughNotes":"x","ownerId":"B"}'],
    ["non-string notes", '{"roughNotes":5}'],
    ["an array", "[]"],
  ])("rejects %s with 400 and saves nothing", async (_label, body) => {
    let called = false;
    const result = await handleSaveNotes(
      () => {
        called = true;
        return Promise.resolve(saved);
      },
      { ownerId: "A", meetingId: "m1", contentType: "application/json", body },
    );
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("requires a JSON content type", async () => {
    const result = await handleSaveNotes(() => Promise.resolve(saved), {
      ownerId: "A",
      meetingId: "m1",
      contentType: "text/plain",
      body: '{"roughNotes":"x"}',
    });
    expect(result.status).toBe(415);
  });

  it("refuses an oversized body before parsing it (413)", async () => {
    const result = await handleSaveNotes(() => Promise.resolve(saved), {
      ownerId: "A",
      meetingId: "m1",
      contentType: "application/json",
      body: JSON.stringify({ roughNotes: "x".repeat(MAX_ROUGH_NOTES_CHARS * 4 + 10) }),
    });
    expect(result.status).toBe(413);
  });

  it("maps use case failures to fixed codes that echo nothing", async () => {
    const notFound = await handleSaveNotes(() => Promise.resolve(err({ kind: "not_found" })), {
      ownerId: "A",
      meetingId: "m1",
      contentType: "application/json",
      body: '{"roughNotes":"x"}',
    });
    expect(notFound).toEqual({ status: 404, body: { error: "not_found" } });

    const tooLong = await handleSaveNotes(
      () =>
        Promise.resolve(
          err({ kind: "invalid", errors: [{ field: "rough_notes", message: "too long" }] }),
        ),
      {
        ownerId: "A",
        meetingId: "m1",
        contentType: "application/json",
        body: '{"roughNotes":"x"}',
      },
    );
    expect(tooLong).toEqual({ status: 422, body: { error: "notes_too_long" } });
  });
});
