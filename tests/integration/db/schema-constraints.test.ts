import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  T0,
  T1,
  attendee,
  chunk,
  consentedMeeting,
  count,
  folder,
  freshDb,
  insert,
  meeting,
  note,
  owner,
  segment,
} from "../../support/db-fixtures";

let db: DatabaseSync;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
});

describe("owner and session", () => {
  it("rejects a duplicate email (emails are stored lower-case, so this is case-insensitive)", () => {
    expect(() => owner(db, "A2", { email: "a@example.test" })).toThrow(/UNIQUE/);
    expect(() => owner(db, "A3", { email: "A@EXAMPLE.TEST" })).toThrow(/CHECK|UNIQUE/);
  });

  it("rejects a non lower-case email", () => {
    expect(() => owner(db, "C", { email: "Mixed@Example.test" })).toThrow(/CHECK/);
  });

  it("rejects timestamps that are not UTC ISO-8601", () => {
    expect(() => owner(db, "C", { created_at: "2026-10-27 09:00:00" })).toThrow(/CHECK/);
    expect(() => owner(db, "D", { created_at: "2026-10-27T09:00:00+02:00" })).toThrow(/CHECK/);
  });

  it("stores only a token hash and rejects idle expiry after absolute expiry", () => {
    const base = {
      id: "s1",
      owner_id: "A",
      token_hash: "h1",
      csrf_secret: "c1",
      created_at: T0,
      last_seen_at: T0,
      idle_expires_at: T1,
      absolute_expires_at: T1,
    };
    insert(db, "session", base);
    expect(() => insert(db, "session", { ...base, id: "s2", token_hash: "h1" })).toThrow(/UNIQUE/);
    expect(() =>
      insert(db, "session", {
        ...base,
        id: "s3",
        token_hash: "h3",
        absolute_expires_at: T0,
        idle_expires_at: T1,
      }),
    ).toThrow(/CHECK/);
  });

  it("rejects a session for an unknown owner", () => {
    expect(() =>
      insert(db, "session", {
        id: "s1",
        owner_id: "nobody",
        token_hash: "h",
        csrf_secret: "c",
        created_at: T0,
        last_seen_at: T0,
        idle_expires_at: T1,
        absolute_expires_at: T1,
      }),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe("folder and template", () => {
  it("makes folder names unique per owner, case-insensitively, but reusable across owners", () => {
    folder(db, "A", "f1", { name: "Board" });
    expect(() => folder(db, "A", "f2", { name: "board" })).toThrow(/UNIQUE/);
    expect(() => folder(db, "B", "f3", { name: "Board" })).not.toThrow();
  });

  it("allows at most one default template per owner and validates sections JSON", () => {
    const t = {
      owner_id: "A",
      sections_json: "[]",
      created_at: T0,
      updated_at: T0,
    };
    insert(db, "template", { ...t, id: "t1", name: "One", is_default: 1 });
    expect(() => insert(db, "template", { ...t, id: "t2", name: "Two", is_default: 1 })).toThrow(
      /UNIQUE/,
    );
    expect(() =>
      insert(db, "template", { ...t, id: "t3", name: "Three", is_default: 0 }),
    ).not.toThrow();
    expect(() =>
      insert(db, "template", { ...t, id: "t4", name: "Four", sections_json: "not json" }),
    ).toThrow(/CHECK/);
  });
});

describe("meeting", () => {
  it("rejects unknown statuses", () => {
    expect(() => meeting(db, "A", "m1", { status: "recording" })).toThrow(/CHECK/);
  });

  it("cannot be in or past capture without a stored consent time (consent invariant)", () => {
    for (const status of ["capturing", "paused", "processing", "review", "published", "failed"]) {
      expect(() => meeting(db, "A", `m-${status}`, { status }), status).toThrow(/CHECK/);
    }
    expect(() => consentedMeeting(db, "A", "ok")).not.toThrow();
  });

  it("stores consent time and statement version together or not at all", () => {
    expect(() => meeting(db, "A", "m1", { consent_confirmed_at: T0 })).toThrow(/CHECK/);
    expect(() => meeting(db, "A", "m2", { consent_statement_version: 1 })).toThrow(/CHECK/);
  });

  it("requires the IANA timezone name and a sane title", () => {
    expect(() => meeting(db, "A", "m1", { timezone: "" })).toThrow(/CHECK/);
    expect(() => meeting(db, "A", "m2", { title: "" })).toThrow(/CHECK/);
    expect(() => meeting(db, "A", "m3", { title: "x".repeat(201) })).toThrow(/CHECK/);
  });

  it("rejects an end before the start", () => {
    expect(() => meeting(db, "A", "m1", { scheduled_end_at: T0, scheduled_start_at: T1 })).toThrow(
      /CHECK/,
    );
  });

  it("imports the same provider event only once per owner, but another owner may", () => {
    const ev = { calendar_provider: "google", provider_event_id: "evt-1" };
    meeting(db, "A", "m1", ev);
    expect(() => meeting(db, "A", "m2", ev)).toThrow(/UNIQUE/);
    expect(() => meeting(db, "B", "m3", ev)).not.toThrow();
    expect(() => meeting(db, "A", "m4")).not.toThrow();
    expect(() => meeting(db, "A", "m5")).not.toThrow();
  });

  it("sets status_before_archive exactly when archived", () => {
    expect(() => meeting(db, "A", "m1", { status: "archived" })).toThrow(/CHECK/);
    expect(() => meeting(db, "A", "m2", { status_before_archive: "scheduled" })).toThrow(/CHECK/);
    expect(() =>
      meeting(db, "A", "m3", { status: "archived", status_before_archive: "scheduled" }),
    ).not.toThrow();
  });

  it("requires a deleted meeting to be scrubbed", () => {
    const deleted = { status: "deleted", deleted_at: T1, title: "" };
    expect(() => meeting(db, "A", "m1", { ...deleted, agenda: "secret" })).toThrow(/CHECK/);
    expect(() => meeting(db, "A", "m2", { ...deleted, title: "Kept title" })).toThrow(/CHECK/);
    expect(() => meeting(db, "A", "m3", deleted)).not.toThrow();
  });

  it("cannot reference a template of another owner", () => {
    insert(db, "template", {
      id: "tB",
      owner_id: "B",
      name: "B template",
      sections_json: "[]",
      created_at: T0,
      updated_at: T0,
    });
    expect(() => meeting(db, "A", "m1", { template_id: "tB" })).toThrow(/FOREIGN KEY/);
  });
});

describe("attendee", () => {
  it("belongs to a meeting of the same owner only", () => {
    meeting(db, "A", "mA");
    expect(() => attendee(db, "B", "mA", "x")).toThrow(/FOREIGN KEY/);
    expect(() => attendee(db, "A", "mA", "x")).not.toThrow();
  });

  it("allows many attendees without email but not a duplicate email on one meeting", () => {
    meeting(db, "A", "mA");
    attendee(db, "A", "mA", "a1");
    attendee(db, "A", "mA", "a2");
    attendee(db, "A", "mA", "a3", { email: "x@example.test" });
    expect(() => attendee(db, "A", "mA", "a4", { email: "x@example.test" })).toThrow(/UNIQUE/);
  });

  it("is removed with its meeting", () => {
    meeting(db, "A", "mA");
    attendee(db, "A", "mA", "a1");
    db.prepare("DELETE FROM meeting WHERE id = ?").run("mA");
    expect(count(db, "attendee")).toBe(0);
  });
});

describe("audio_chunk", () => {
  beforeEach(() => {
    consentedMeeting(db, "A", "mA");
  });

  it("makes (meeting, seq) the upload idempotency key", () => {
    chunk(db, "A", "mA", 0);
    expect(() => chunk(db, "A", "mA", 0, { id: "other" })).toThrow(/UNIQUE/);
  });

  it("bounds size, duration and content type", () => {
    expect(() => chunk(db, "A", "mA", 1, { byte_size: 1048577 })).toThrow(/CHECK/);
    expect(() => chunk(db, "A", "mA", 2, { byte_size: 0 })).toThrow(/CHECK/);
    expect(() => chunk(db, "A", "mA", 3, { content_type: "text/html" })).toThrow(/CHECK/);
    expect(() => chunk(db, "A", "mA", 4, { duration_ms: 0 })).toThrow(/CHECK/);
    expect(() => chunk(db, "A", "mA", 5, { seq: -1 })).toThrow(/CHECK/);
  });

  it("has an object key exactly while the raw audio exists", () => {
    expect(() => chunk(db, "A", "mA", 1, { state: "purged" })).toThrow(/CHECK/);
    expect(() =>
      chunk(db, "A", "mA", 2, { state: "purged", object_key: null, purged_at: T1 }),
    ).not.toThrow();
    expect(() => chunk(db, "A", "mA", 3, { state: "uploaded", object_key: null })).toThrow(/CHECK/);
  });

  it("cannot belong to another owner's meeting", () => {
    expect(() => chunk(db, "B", "mA", 9)).toThrow(/FOREIGN KEY/);
  });
});

describe("transcript_segment", () => {
  beforeEach(() => {
    consentedMeeting(db, "A", "mA");
    chunk(db, "A", "mA", 0);
  });

  it("cannot be duplicated for the same chunk and index (idempotent transcription)", () => {
    segment(db, "A", "mA", 0, 0);
    expect(() => segment(db, "A", "mA", 0, 0, { id: "dup" })).toThrow(/UNIQUE/);
    expect(() => segment(db, "A", "mA", 0, 1)).not.toThrow();
  });

  it("requires an existing chunk of the same meeting and owner", () => {
    expect(() => segment(db, "A", "mA", 7, 0)).toThrow(/FOREIGN KEY/);
    expect(() => segment(db, "B", "mA", 0, 5)).toThrow(/FOREIGN KEY/);
  });

  it("orders by a generated position and validates the time range", () => {
    chunk(db, "A", "mA", 2);
    segment(db, "A", "mA", 2, 3);
    const row = db.prepare("SELECT position FROM transcript_segment WHERE seg_index = 3").get();
    expect(row).toEqual({ position: 20003 });
    expect(() => segment(db, "A", "mA", 0, 2, { start_ms: 2000, end_ms: 1000 })).toThrow(/CHECK/);
    expect(() => segment(db, "A", "mA", 0, 10000)).toThrow(/CHECK/);
  });

  it("is removed when the meeting is removed", () => {
    segment(db, "A", "mA", 0, 0);
    db.prepare("DELETE FROM meeting WHERE id = ?").run("mA");
    expect(count(db, "transcript_segment")).toBe(0);
    expect(count(db, "audio_chunk")).toBe(0);
  });
});

describe("note, sections, decisions, action items", () => {
  beforeEach(() => {
    consentedMeeting(db, "A", "mA", { status: "review" });
    folder(db, "A", "fA");
    folder(db, "B", "fB");
  });

  it("allows one note per meeting", () => {
    note(db, "A", "mA", "n1");
    expect(() => note(db, "A", "mA", "n2")).toThrow(/UNIQUE/);
  });

  it("is a draft until a person publishes into an owned folder", () => {
    expect(() => note(db, "A", "mA", "n1", { status: "published" })).toThrow(/CHECK/);
    expect(() => note(db, "A", "mA", "n2", { status: "published", published_at: T1 })).toThrow(
      /CHECK/,
    );
    expect(() =>
      note(db, "A", "mA", "n3", { status: "draft", folder_id: "fA", published_at: T1 }),
    ).toThrow(/CHECK/);
    expect(() =>
      note(db, "A", "mA", "n4", { status: "published", published_at: T1, folder_id: "fB" }),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      note(db, "A", "mA", "n5", { status: "published", published_at: T1, folder_id: "fA" }),
    ).not.toThrow();
  });

  it("blocks deleting a folder that still holds a note", () => {
    note(db, "A", "mA", "n1", { status: "published", published_at: T1, folder_id: "fA" });
    expect(() => db.prepare("DELETE FROM folder WHERE id = ?").run("fA")).toThrow(/FOREIGN KEY/);
  });

  it("keeps source ranges all-or-nothing and ordered", () => {
    note(db, "A", "mA", "n1");
    const s = {
      owner_id: "A",
      note_id: "n1",
      heading: "Summary",
      body: "Body",
      created_at: T0,
      updated_at: T0,
    };
    expect(() =>
      insert(db, "note_section", { ...s, id: "s1", position: 0, source_from: 1, source_to: 5 }),
    ).not.toThrow();
    expect(() =>
      insert(db, "note_section", { ...s, id: "s2", position: 1, source_from: 5, source_to: 1 }),
    ).toThrow(/CHECK/);
    expect(() =>
      insert(db, "note_section", { ...s, id: "s3", position: 2, source_from: 1 }),
    ).toThrow(/CHECK/);
    expect(() => insert(db, "note_section", { ...s, id: "s4", position: 0 })).toThrow(/UNIQUE/);
    expect(() =>
      insert(db, "decision", {
        id: "d1",
        owner_id: "A",
        note_id: "n1",
        position: 0,
        text: "Ship Friday",
        source_from: 1,
        source_to: 2,
        created_at: T0,
        updated_at: T0,
      }),
    ).not.toThrow();
  });

  it("rejects an assignee who is not an attendee of the same meeting and owner", () => {
    note(db, "A", "mA", "n1");
    attendee(db, "A", "mA", "a1");
    consentedMeeting(db, "A", "mA2");
    attendee(db, "A", "mA2", "a2");
    const item = {
      owner_id: "A",
      meeting_id: "mA",
      note_id: "n1",
      position: 0,
      text: "Send the deck",
      status: "open",
      created_at: T0,
      updated_at: T0,
    };
    expect(() =>
      insert(db, "action_item", { ...item, id: "i1", assignee_attendee_id: "a1" }),
    ).not.toThrow();
    expect(() =>
      insert(db, "action_item", { ...item, id: "i2", position: 1, assignee_attendee_id: "a2" }),
    ).toThrow(/FOREIGN KEY/);
    expect(() => insert(db, "action_item", { ...item, id: "i3", position: 2 })).not.toThrow();
  });

  it("stores due date and its timezone together", () => {
    note(db, "A", "mA", "n1");
    const item = {
      owner_id: "A",
      meeting_id: "mA",
      note_id: "n1",
      text: "x",
      status: "open",
      created_at: T0,
      updated_at: T0,
    };
    expect(() => insert(db, "action_item", { ...item, id: "i1", position: 0, due_at: T1 })).toThrow(
      /CHECK/,
    );
    expect(() =>
      insert(db, "action_item", { ...item, id: "i2", position: 1, due_timezone: "UTC" }),
    ).toThrow(/CHECK/);
    expect(() =>
      insert(db, "action_item", {
        ...item,
        id: "i3",
        position: 2,
        due_at: T1,
        due_timezone: "Europe/Paris",
      }),
    ).not.toThrow();
    expect(() =>
      insert(db, "action_item", { ...item, id: "i4", position: 3, status: "blocked" }),
    ).toThrow(/CHECK/);
  });

  it("cascades the whole note tree when the meeting is removed", () => {
    note(db, "A", "mA", "n1");
    insert(db, "note_section", {
      id: "s1",
      owner_id: "A",
      note_id: "n1",
      position: 0,
      heading: "h",
      body: "b",
      created_at: T0,
      updated_at: T0,
    });
    attendee(db, "A", "mA", "a1");
    insert(db, "action_item", {
      id: "i1",
      owner_id: "A",
      meeting_id: "mA",
      note_id: "n1",
      position: 0,
      text: "t",
      status: "open",
      assignee_attendee_id: "a1",
      created_at: T0,
      updated_at: T0,
    });
    db.prepare("DELETE FROM meeting WHERE id = ?").run("mA");
    for (const t of ["note", "note_section", "action_item", "attendee"]) {
      expect(count(db, t), t).toBe(0);
    }
  });
});

describe("job, audit, provider_event, idempotency_key, settings", () => {
  const job = {
    id: "j1",
    owner_id: "A",
    kind: "transcribe",
    job_key: "transcribe:mA",
    status: "pending",
    attempts: 0,
    max_attempts: 5,
    created_at: T0,
    updated_at: T0,
  };

  it("keeps exactly one job per job_key", () => {
    insert(db, "job", job);
    expect(() => insert(db, "job", { ...job, id: "j2" })).toThrow(/UNIQUE/);
  });

  it("validates status, kind and attempts", () => {
    expect(() => insert(db, "job", { ...job, status: "done" })).toThrow(/CHECK/);
    expect(() => insert(db, "job", { ...job, kind: "mine-bitcoin" })).toThrow(/CHECK/);
    expect(() => insert(db, "job", { ...job, attempts: 6 })).toThrow(/CHECK/);
  });

  it("makes audit_event append-only", () => {
    insert(db, "audit_event", {
      id: "e1",
      owner_id: "A",
      meeting_id: "mA",
      kind: "meeting.consent_confirmed",
      actor: "owner",
      detail_json: "{}",
      occurred_at: T0,
    });
    expect(() => db.prepare("UPDATE audit_event SET kind = 'x' WHERE id = 'e1'").run()).toThrow(
      /append-only/,
    );
    expect(() => db.prepare("DELETE FROM audit_event WHERE id = 'e1'").run()).toThrow(
      /append-only/,
    );
    expect(count(db, "audit_event")).toBe(1);
  });

  it("keeps audit records after the meeting is physically removed (no FK to meeting)", () => {
    meeting(db, "A", "mA");
    insert(db, "audit_event", {
      id: "e1",
      owner_id: "A",
      meeting_id: "mA",
      kind: "meeting.created",
      actor: "owner",
      detail_json: "{}",
      occurred_at: T0,
    });
    db.prepare("DELETE FROM meeting WHERE id = 'mA'").run();
    expect(count(db, "audit_event")).toBe(1);
  });

  it("dedupes provider events by (provider, event_id)", () => {
    const ev = { id: "p1", provider: "google", event_id: "e1", received_at: T0 };
    insert(db, "provider_event", ev);
    expect(() => insert(db, "provider_event", { ...ev, id: "p2" })).toThrow(/UNIQUE/);
  });

  it("dedupes submissions by (owner, scope, key) and lets another owner reuse a key", () => {
    const k = {
      owner_id: "A",
      scope: "meeting.create",
      key: "k1",
      resource_id: "m1",
      created_at: T0,
      expires_at: T1,
    };
    insert(db, "idempotency_key", k);
    expect(() => insert(db, "idempotency_key", k)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => insert(db, "idempotency_key", { ...k, owner_id: "B" })).not.toThrow();
  });

  it("stores audio retention as a bounded number of hours, default 0", () => {
    insert(db, "settings", { owner_id: "A", updated_at: T0 });
    expect(db.prepare("SELECT raw_audio_retention_hours AS h FROM settings").get()).toEqual({
      h: 0,
    });
    expect(() =>
      insert(db, "settings", { owner_id: "B", updated_at: T0, raw_audio_retention_hours: 169 }),
    ).toThrow(/CHECK/);
  });

  it("stores provider tokens as ciphertext, one per owner and provider", () => {
    const tok = {
      id: "t1",
      owner_id: "A",
      provider: "google",
      access_ciphertext: "v1.x",
      key_id: "dev",
      created_at: T0,
      updated_at: T0,
    };
    insert(db, "provider_token", tok);
    expect(() => insert(db, "provider_token", { ...tok, id: "t2" })).toThrow(/UNIQUE/);
  });
});

describe("search_index (derived FTS)", () => {
  function index(ownerId: string, meetingId: string, title: string, body: string): void {
    insert(db, "search_index", {
      title,
      body,
      owner_id: ownerId,
      meeting_id: meetingId,
      kind: "note_section",
      ref_id: "r",
    });
  }

  function hits(ownerId: string, query: string): string[] {
    return db
      .prepare(
        "SELECT meeting_id FROM search_index WHERE search_index MATCH ? AND owner_id = ? ORDER BY rank",
      )
      .all(query, ownerId)
      .map((r) => String(r["meeting_id"]));
  }

  it("never returns another owner's rows when filtered by owner_id", () => {
    index("A", "mA", "Pricing", "We decided on annual pricing");
    index("B", "mB", "Pricing", "Secret pricing plan");
    expect(hits("A", "pricing")).toEqual(["mA"]);
    expect(hits("B", "pricing")).toEqual(["mB"]);
  });

  it("drops a meeting's hits as soon as it enters deleting, in the same transaction", () => {
    consentedMeeting(db, "A", "mA", { status: "review" });
    index("A", "mA", "Pricing", "annual pricing");
    expect(hits("A", "pricing")).toEqual(["mA"]);
    db.prepare("UPDATE meeting SET status = 'deleting' WHERE id = 'mA'").run();
    expect(hits("A", "pricing")).toEqual([]);
  });
});
