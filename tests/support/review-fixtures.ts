import type { DatabaseSync } from "node:sqlite";
import { DEV_KEYRING } from "../../src/adapters/crypto/dev-keyring";
import { createEnvelopeCipher, parseKeyring } from "../../src/adapters/crypto/envelope-cipher";
import { segmentTextContext } from "../../src/domain/transcription/encryption-context";
import { T0, attendee, chunk, consentedMeeting, insert, note, segment } from "./db-fixtures";

const cipher = createEnvelopeCipher(parseKeyring(DEV_KEYRING.spec), DEV_KEYRING.activeKeyId);

/**
 * A meeting in the given status with two attendees, three encrypted transcript segments (two
 * speakers), a note with two sections, a decision and an action item. Ids are prefixed by the
 * meeting id (`<id>-a1`, `<id>-sec-0`, `<id>-dec-0`, `<id>-act-0`); a published note goes into
 * `folder-<ownerId>`, which the caller creates.
 */
export async function seedReviewMeeting(
  db: DatabaseSync,
  ownerId: string,
  id: string,
  status = "review",
): Promise<void> {
  consentedMeeting(db, ownerId, id, { status, timezone: "Europe/Paris" });
  attendee(db, ownerId, id, `${id}-a1`, { name: "Ada Lovelace" });
  attendee(db, ownerId, id, `${id}-a2`, { name: "Grace Hopper" });
  chunk(db, ownerId, id, 0, { state: "purged", object_key: null, purged_at: T0 });
  chunk(db, ownerId, id, 1, { state: "purged", object_key: null, purged_at: T0 });
  const lines: [number, number, string, string][] = [
    [0, 0, "Speaker 1", "Let's review the roadmap."],
    [0, 1, "Speaker 2", "We ship in November."],
    [1, 0, "Speaker 1", "I will send the deck."],
  ];
  for (const [seq, index, speaker, text] of lines) {
    const segId = `${id}-seg-${String(seq)}-${String(index)}`;
    const sealed = await cipher.encrypt(text, segmentTextContext(segId));
    segment(db, ownerId, id, seq, index, {
      id: segId,
      speaker_label: speaker,
      speaker_label_original: speaker,
      text_ciphertext: sealed.ciphertext,
      text_key_id: sealed.keyId,
    });
  }
  const noteId = `${id}-note`;
  note(
    db,
    ownerId,
    id,
    noteId,
    status === "published"
      ? { status: "published", folder_id: `folder-${ownerId}`, published_at: T0 }
      : {},
  );
  for (const [position, heading, body] of [
    [0, "Summary", "We reviewed the roadmap."],
    [1, "Risks", "Pricing is pending."],
  ] as const) {
    const sid = `${id}-sec-${String(position)}`;
    insert(db, "note_section", {
      id: sid,
      owner_id: ownerId,
      note_id: noteId,
      position,
      heading,
      body,
      source_from: 0,
      source_to: 10000,
      created_at: T0,
      updated_at: T0,
    });
    insert(db, "search_index", {
      title: heading,
      body,
      owner_id: ownerId,
      meeting_id: id,
      kind: "note_section",
      ref_id: sid,
    });
  }
  insert(db, "decision", {
    id: `${id}-dec-0`,
    owner_id: ownerId,
    note_id: noteId,
    position: 0,
    text: "Ship in November",
    source_from: 1,
    source_to: 1,
    created_at: T0,
    updated_at: T0,
  });
  insert(db, "action_item", {
    id: `${id}-act-0`,
    owner_id: ownerId,
    meeting_id: id,
    note_id: noteId,
    position: 0,
    text: "Send the deck",
    assignee_attendee_id: `${id}-a1`,
    due_at: "2026-10-30T22:59:59.000Z",
    due_timezone: "Europe/Paris",
    status: "open",
    source_from: 10000,
    source_to: 10000,
    created_at: T0,
    updated_at: T0,
  });
}
