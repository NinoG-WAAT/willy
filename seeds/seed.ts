import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { DEV_KEYRING } from "../src/adapters/crypto/dev-keyring";
import { segmentTextContext } from "../src/domain/transcription/encryption-context";
import type { PasswordHasher } from "../src/ports/password-hasher";
import type { TextCipher } from "../src/ports/text-cipher";

export { DEV_KEYRING };

/** Development-only password for both seeded owners. Never use it anywhere real. */
export const DEV_PASSWORD = "willy-dev-password";

export interface SeedIds {
  /** Fixed "current time" of the seed; the overdue action item is due before this. */
  now: string;
  ownerA: string;
  ownerB: string;
  meetings: {
    published: string;
    empty: string;
    failed: string;
    /** In `review` with an overdue open action item. */
    overdue: string;
    archived: string;
    deleting: string;
    /** Owned by owner B: owner A must never see it. */
    otherOwner: string;
  };
}

const NOW = "2026-10-27T12:00:00.000Z";
const DAY = 24 * 3600 * 1000;
const at = (offsetDays: number): string =>
  new Date(Date.parse(NOW) + offsetDays * DAY).toISOString();

type Row = Record<string, SQLInputValue>;

function insert(db: DatabaseSync, table: string, row: Row): void {
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
  ).run(...Object.values(row));
}

interface MeetingSeed {
  id: string;
  ownerId: string;
  status: string;
  title: string;
  startOffsetDays: number;
  extra?: Row;
}

function insertMeeting(db: DatabaseSync, m: MeetingSeed): void {
  const consented = !["scheduled", "archived", "deleting"].includes(m.status);
  insert(db, "meeting", {
    id: m.id,
    owner_id: m.ownerId,
    status: m.status,
    title: m.title,
    scheduled_start_at: at(m.startOffsetDays),
    scheduled_end_at: at(m.startOffsetDays + 1 / 24),
    timezone: "Europe/Paris",
    consent_confirmed_at: consented ? at(m.startOffsetDays) : null,
    consent_statement_version: consented ? 1 : null,
    created_at: at(m.startOffsetDays - 1),
    updated_at: at(m.startOffsetDays),
    ...m.extra,
  });
}

function insertAttendee(
  db: DatabaseSync,
  ownerId: string,
  meetingId: string,
  id: string,
  name: string,
  email: string | null,
): void {
  insert(db, "attendee", {
    id,
    owner_id: ownerId,
    meeting_id: meetingId,
    name,
    email,
    created_at: at(-30),
  });
}

async function insertTranscript(
  db: DatabaseSync,
  cipher: TextCipher,
  ownerId: string,
  meetingId: string,
  chunkStates: string[],
  lines: string[][],
): Promise<void> {
  for (const [seq, state] of chunkStates.entries()) {
    const purged = state === "purged";
    insert(db, "audio_chunk", {
      id: `${meetingId}-chunk-${String(seq)}`,
      owner_id: ownerId,
      meeting_id: meetingId,
      seq,
      state,
      byte_size: 48_000,
      duration_ms: 10_000,
      content_type: "audio/webm",
      sha256: String(seq + 1)
        .repeat(64)
        .slice(0, 64),
      key_id: "dev",
      object_key: purged ? null : `owner/${ownerId}/meeting/${meetingId}/chunk-${String(seq)}`,
      transcription_attempts: state === "failed" ? 5 : 1,
      last_error_code: state === "failed" ? "provider_unavailable" : null,
      created_at: at(-2),
      transcribed_at: state === "failed" ? null : at(-2),
      purged_at: purged ? at(-2) : null,
    });
    for (const [index, text] of (lines[seq] ?? []).entries()) {
      const id = `${meetingId}-seg-${String(seq)}-${String(index)}`;
      const sealed = await cipher.encrypt(text, segmentTextContext(id));
      insert(db, "transcript_segment", {
        id,
        owner_id: ownerId,
        meeting_id: meetingId,
        chunk_seq: seq,
        seg_index: index,
        start_ms: index * 5000,
        end_ms: index * 5000 + 4000,
        speaker_label: index % 2 === 0 ? "Speaker 1" : "Speaker 2",
        speaker_label_original: index % 2 === 0 ? "Speaker 1" : "Speaker 2",
        text_ciphertext: sealed.ciphertext,
        text_key_id: sealed.keyId,
        created_at: at(-2),
        updated_at: at(-2),
      });
    }
  }
}

function indexForSearch(
  db: DatabaseSync,
  ownerId: string,
  meetingId: string,
  kind: string,
  refId: string,
  title: string,
  body: string,
): void {
  insert(db, "search_index", {
    title,
    body,
    owner_id: ownerId,
    meeting_id: meetingId,
    kind,
    ref_id: refId,
  });
}

function insertNote(
  db: DatabaseSync,
  ownerId: string,
  meetingId: string,
  status: "draft" | "published",
  folderId: string | null,
): string {
  const id = `${meetingId}-note`;
  insert(db, "note", {
    id,
    owner_id: ownerId,
    meeting_id: meetingId,
    status,
    revision: 1,
    folder_id: folderId,
    generated_at: at(-2),
    published_at: status === "published" ? at(-1) : null,
    created_at: at(-2),
    updated_at: at(-1),
  });
  return id;
}

function insertSection(
  db: DatabaseSync,
  ownerId: string,
  meetingId: string,
  noteId: string,
  position: number,
  heading: string,
  body: string,
  from: number,
  to: number,
): void {
  const id = `${noteId}-section-${String(position)}`;
  insert(db, "note_section", {
    id,
    owner_id: ownerId,
    note_id: noteId,
    position,
    heading,
    body,
    source_from: from,
    source_to: to,
    created_at: at(-2),
    updated_at: at(-2),
  });
  indexForSearch(db, ownerId, meetingId, "note_section", id, heading, body);
}

function insertActionItem(
  db: DatabaseSync,
  ownerId: string,
  meetingId: string,
  noteId: string,
  position: number,
  text: string,
  status: "open" | "done",
  dueOffsetDays: number,
  assignee: string | null,
): void {
  const id = `${noteId}-action-${String(position)}`;
  insert(db, "action_item", {
    id,
    owner_id: ownerId,
    meeting_id: meetingId,
    note_id: noteId,
    position,
    text,
    assignee_attendee_id: assignee,
    due_at: at(dueOffsetDays),
    due_timezone: "Europe/Paris",
    status,
    created_at: at(-2),
    updated_at: at(-2),
  });
  indexForSearch(db, ownerId, meetingId, "action_item", id, "Action item", text);
}

function audit(
  db: DatabaseSync,
  ownerId: string,
  meetingId: string,
  n: number,
  kind: string,
  offsetDays: number,
  detail: Row = {},
): void {
  insert(db, "audit_event", {
    id: `${meetingId}-audit-${String(n)}`,
    owner_id: ownerId,
    meeting_id: meetingId,
    kind,
    actor: "owner",
    detail_json: JSON.stringify(detail),
    occurred_at: at(offsetDays),
  });
}

/**
 * Representative development data: two distinct owners; for owner A the happy path plus empty,
 * failed, overdue, archived and deleting states; for owner B a meeting A must never see.
 * Transcript text goes through the real cipher. Both owners get the development password `DEV_PASSWORD`.
 */
export async function seedDatabase(
  db: DatabaseSync,
  cipher: TextCipher,
  hasher: PasswordHasher,
): Promise<SeedIds> {
  const ids: SeedIds = {
    now: NOW,
    ownerA: "owner-ada",
    ownerB: "owner-ben",
    meetings: {
      published: "meeting-a-published",
      empty: "meeting-a-empty",
      failed: "meeting-a-failed",
      overdue: "meeting-a-overdue",
      archived: "meeting-a-archived",
      deleting: "meeting-a-deleting",
      otherOwner: "meeting-b-published",
    },
  };
  const { ownerA, ownerB, meetings: m } = ids;

  const passwordHash = await hasher.hash(DEV_PASSWORD);

  db.exec("BEGIN");
  try {
    insert(db, "owner", {
      id: ownerA,
      email: "ada@example.test",
      display_name: "Ada Founder",
      password_hash: passwordHash,
      created_at: at(-60),
    });
    insert(db, "owner", {
      id: ownerB,
      email: "ben@example.test",
      display_name: "Ben Founder",
      password_hash: passwordHash,
      created_at: at(-60),
    });
    for (const owner of [ownerA, ownerB]) {
      insert(db, "settings", { owner_id: owner, updated_at: at(-60) });
    }

    // Owner A: folder, template, happy path.
    insert(db, "folder", {
      id: "folder-a-board",
      owner_id: ownerA,
      name: "Board updates",
      created_at: at(-30),
      updated_at: at(-30),
    });
    insert(db, "template", {
      id: "template-a-weekly",
      owner_id: ownerA,
      name: "Weekly sync",
      sections_json: JSON.stringify([
        { heading: "Summary", prompt: "Summarize the discussion." },
        { heading: "Risks", prompt: "List risks raised." },
      ]),
      is_default: 1,
      created_at: at(-30),
      updated_at: at(-30),
    });

    insertMeeting(db, {
      id: m.published,
      ownerId: ownerA,
      status: "published",
      title: "Weekly sync with Grace",
      startOffsetDays: -7,
      extra: {
        template_id: "template-a-weekly",
        agenda: "Roadmap review; hiring",
        rough_notes: "Roadmap: ship beta in November.",
      },
    });
    insertAttendee(db, ownerA, m.published, "att-a-ada", "Ada Founder", "ada@example.test");
    insertAttendee(db, ownerA, m.published, "att-a-grace", "Grace Hopper", "grace@example.test");
    await insertTranscript(
      db,
      cipher,
      ownerA,
      m.published,
      ["purged", "purged"],
      [
        ["Let's review the roadmap for the beta.", "I think we can ship the beta in November."],
        ["Agreed, we will ship the beta in November.", "I will send the pricing deck by Friday."],
      ],
    );
    const published = insertNote(db, ownerA, m.published, "published", "folder-a-board");
    insertSection(
      db,
      ownerA,
      m.published,
      published,
      0,
      "Summary",
      "The team reviewed the roadmap and agreed the beta ships in November.",
      0,
      10001,
    );
    insertSection(
      db,
      ownerA,
      m.published,
      published,
      1,
      "Risks",
      "Pricing deck still pending.",
      10001,
      10001,
    );
    insert(db, "decision", {
      id: `${published}-decision-0`,
      owner_id: ownerA,
      note_id: published,
      position: 0,
      text: "Ship the beta in November.",
      source_from: 10000,
      source_to: 10000,
      created_at: at(-2),
      updated_at: at(-2),
    });
    indexForSearch(
      db,
      ownerA,
      m.published,
      "decision",
      `${published}-decision-0`,
      "Decision",
      "Ship the beta in November.",
    );
    insertActionItem(
      db,
      ownerA,
      m.published,
      published,
      0,
      "Send the pricing deck",
      "done",
      -5,
      "att-a-ada",
    );
    insertActionItem(
      db,
      ownerA,
      m.published,
      published,
      1,
      "Draft the hiring plan",
      "open",
      14,
      "att-a-grace",
    );
    indexForSearch(
      db,
      ownerA,
      m.published,
      "meeting",
      m.published,
      "Weekly sync with Grace",
      "Roadmap review; hiring Roadmap: ship beta in November.",
    );
    audit(db, ownerA, m.published, 0, "meeting.consent_confirmed", -7, { statementVersion: 1 });
    audit(db, ownerA, m.published, 1, "meeting.status_changed", -7, {
      from: "scheduled",
      to: "capturing",
    });
    audit(db, ownerA, m.published, 2, "meeting.status_changed", -1, {
      from: "review",
      to: "published",
    });

    // Empty: just created, nothing captured.
    insertMeeting(db, {
      id: m.empty,
      ownerId: ownerA,
      status: "scheduled",
      title: "Intro call (not started)",
      startOffsetDays: 2,
    });

    // Failed transcription after some chunks; rough notes survive.
    insertMeeting(db, {
      id: m.failed,
      ownerId: ownerA,
      status: "failed",
      title: "Customer call (transcription failed)",
      startOffsetDays: -3,
      extra: { rough_notes: "Customer wants SSO. Follow up on pricing." },
    });
    insertAttendee(db, ownerA, m.failed, "att-a-failed-cust", "Customer Contact", null);
    await insertTranscript(
      db,
      cipher,
      ownerA,
      m.failed,
      ["purged", "failed"],
      [["Thanks for joining, let's talk about single sign-on."], []],
    );
    insert(db, "job", {
      id: `job-${m.failed}`,
      owner_id: ownerA,
      meeting_id: m.failed,
      kind: "transcribe",
      job_key: `transcribe:${m.failed}`,
      status: "failed",
      attempts: 5,
      max_attempts: 5,
      last_error_code: "provider_unavailable",
      created_at: at(-3),
      updated_at: at(-3),
    });
    indexForSearch(
      db,
      ownerA,
      m.failed,
      "meeting",
      m.failed,
      "Customer call (transcription failed)",
      "Customer wants SSO. Follow up on pricing.",
    );

    // Overdue: draft note awaiting review with an open action item past its due date.
    insertMeeting(db, {
      id: m.overdue,
      ownerId: ownerA,
      status: "review",
      title: "Investor update prep",
      startOffsetDays: -9,
    });
    insertAttendee(db, ownerA, m.overdue, "att-a-inv", "Ines Investor", "ines@example.test");
    await insertTranscript(
      db,
      cipher,
      ownerA,
      m.overdue,
      ["purged"],
      [["We need the roadmap slides before the update.", "I will prepare them."]],
    );
    const draft = insertNote(db, ownerA, m.overdue, "draft", null);
    insertSection(
      db,
      ownerA,
      m.overdue,
      draft,
      0,
      "Summary",
      "Prepare roadmap slides for the investor update.",
      0,
      1,
    );
    insertActionItem(
      db,
      ownerA,
      m.overdue,
      draft,
      0,
      "Prepare roadmap slides",
      "open",
      -7,
      "att-a-inv",
    );
    indexForSearch(db, ownerA, m.overdue, "meeting", m.overdue, "Investor update prep", "");

    // Archived and deleting.
    insertMeeting(db, {
      id: m.archived,
      ownerId: ownerA,
      status: "archived",
      title: "Old kickoff",
      startOffsetDays: -90,
      extra: { status_before_archive: "scheduled" },
    });
    insertMeeting(db, {
      id: m.deleting,
      ownerId: ownerA,
      status: "deleting",
      title: "Meeting being deleted",
      startOffsetDays: -40,
    });
    insertAttendee(db, ownerA, m.deleting, "att-a-deleting", "Pending Removal", null);
    insert(db, "job", {
      id: `job-${m.deleting}`,
      owner_id: ownerA,
      meeting_id: m.deleting,
      kind: "delete",
      job_key: `delete:${m.deleting}`,
      status: "pending",
      created_at: at(0),
      updated_at: at(0),
    });
    audit(db, ownerA, m.deleting, 0, "meeting.deletion_requested", 0);

    // Owner B: a meeting owner A must never see.
    insert(db, "folder", {
      id: "folder-b-board",
      owner_id: ownerB,
      name: "Board updates",
      created_at: at(-30),
      updated_at: at(-30),
    });
    insertMeeting(db, {
      id: m.otherOwner,
      ownerId: ownerB,
      status: "published",
      title: "Ben's confidential roadmap review",
      startOffsetDays: -5,
      extra: { rough_notes: "Roadmap includes acquisition talks." },
    });
    insertAttendee(db, ownerB, m.otherOwner, "att-b-1", "Ben Founder", "ben@example.test");
    await insertTranscript(
      db,
      cipher,
      ownerB,
      m.otherOwner,
      ["purged"],
      [["The roadmap depends on the acquisition."]],
    );
    const bNote = insertNote(db, ownerB, m.otherOwner, "published", "folder-b-board");
    insertSection(
      db,
      ownerB,
      m.otherOwner,
      bNote,
      0,
      "Summary",
      "Confidential roadmap discussion about an acquisition.",
      0,
      0,
    );
    indexForSearch(
      db,
      ownerB,
      m.otherOwner,
      "meeting",
      m.otherOwner,
      "Ben's confidential roadmap review",
      "Roadmap includes acquisition talks.",
    );

    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
  return ids;
}
