import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteProviderIssueQuery } from "../../../src/adapters/sqlite/provider-issue-query";
import {
  loadProviderStatus,
  type ProviderStatusDeps,
} from "../../../src/app/settings/provider-status";
import { T0, freshDb, insert, meeting, owner } from "../../support/db-fixtures";

let db: DatabaseSync;
let deps: ProviderStatusDeps;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
  meeting(db, "A", "m-a");
  meeting(db, "B", "m-b");
  deps = {
    issues: new SqliteProviderIssueQuery(db),
    modes: { calendar: "fake", speech_to_text: "deepgram", summaries: "fake", storage: "local" },
    knownIssues: [],
  };
});

let seq = 0;
function job(ownerId: string, meetingId: string, status: string, code: string | null, at = T0) {
  seq += 1;
  insert(db, "job", {
    id: `job-${String(seq)}`,
    owner_id: ownerId,
    meeting_id: meetingId,
    kind: "transcribe",
    job_key: `k-${String(seq)}`,
    status,
    attempts: 1,
    next_run_at: status === "retrying" ? at : null,
    last_error_code: code,
    created_at: T0,
    updated_at: at,
  });
}

const state = async (ownerId: string, id: string) =>
  (await loadProviderStatus(deps, ownerId)).find((s) => s.id === id);

describe("loadProviderStatus", () => {
  it("reports configured, fake and local storage with no jobs", async () => {
    const all = await loadProviderStatus(deps, "A");
    expect(all.map((s) => [s.id, s.state])).toEqual([
      ["calendar", "fake"],
      ["speech_to_text", "configured"],
      ["summaries", "fake"],
      ["storage", "configured"],
    ]);
  });

  it("marks speech-to-text degraded from the owner's retrying or failed jobs, with the last redacted code", async () => {
    job("A", "m-a", "retrying", "stt_timeout", "2026-10-27T09:00:00.000Z");
    job("A", "m-a", "failed", "stt_unavailable", "2026-10-27T09:30:00.000Z");
    const stt = await state("A", "speech_to_text");
    expect(stt).toMatchObject({
      state: "degraded",
      lastError: { code: "stt_unavailable", at: "2026-10-27T09:30:00.000Z" },
    });
  });

  it("does not count succeeded jobs or jobs without an error code", async () => {
    job("A", "m-a", "succeeded", "stt_timeout");
    job("A", "m-a", "failed", null);
    expect((await state("A", "speech_to_text"))?.state).toBe("configured");
  });

  it("never lets owner B's failures show up for owner A", async () => {
    job("B", "m-b", "failed", "stt_unavailable");
    expect((await state("A", "speech_to_text"))?.state).toBe("configured");
    expect((await state("B", "speech_to_text"))?.state).toBe("degraded");
  });

  it("includes known issues such as an unavailable calendar connection", async () => {
    deps = {
      ...deps,
      modes: { ...deps.modes, calendar: "google" },
      knownIssues: [{ code: "calendar_not_connected", at: null }],
    };
    expect(await state("A", "calendar")).toMatchObject({
      state: "degraded",
      lastError: { code: "calendar_not_connected" },
    });
  });

  it("carries only codes, summaries and times: no job ids, meeting ids or payloads", async () => {
    job("A", "m-a", "failed", "stt_unavailable");
    const flat = JSON.stringify(await loadProviderStatus(deps, "A"));
    expect(flat).not.toContain("m-a");
    expect(flat).not.toContain("job-");
  });
});
