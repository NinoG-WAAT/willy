import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { Attendee } from "../../domain/meetings/attendee";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import type { CalendarEvent } from "../../domain/calendar/event";
import type {
  CalendarImportRepository,
  ImportOutcome,
} from "../../ports/calendar-import-repository";
import type { Clock } from "../../ports/clock";
import type { IdGenerator } from "../../ports/id-generator";
import type { MeetingCreation, NewMeetingRecord } from "../../ports/meeting-creation";
import type {
  MeetingDetail,
  MeetingDetailQuery,
  RoughNotesStore,
} from "../../ports/meeting-detail";
import { err, ok, type Result } from "../../domain/platform/result";
import type {
  MeetingListFilter,
  MeetingListItem,
  MeetingListQuery,
} from "../../ports/meeting-list";
import { MEETING_CARD_COLUMNS, toMeetingListItem } from "./meeting-list-row";
import { reindexMeetingRow } from "./search-rows";
import { inTransaction, settle } from "./transaction";

const LIST_LIMIT = 200;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const CREATE_SCOPE = "create_meeting";

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * Meetings as seen by the home screen and the creation paths (manual form, calendar import).
 * Every statement is scoped by owner_id. Three small ports, one SQLite class.
 */
export class SqliteMeetingCatalog
  implements
    MeetingListQuery,
    MeetingCreation,
    CalendarImportRepository,
    MeetingDetailQuery,
    RoughNotesStore
{
  constructor(
    private readonly db: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  list(ownerId: string, filter: MeetingListFilter): Promise<MeetingListItem[]> {
    const params: SQLInputValue[] = [ownerId];
    let where = "m.owner_id = ? AND m.status NOT IN ('deleting', 'deleted')";
    if (!filter.includeArchived) where += " AND m.status <> 'archived'";
    if (filter.folderId !== null) {
      where += " AND n.folder_id = ?";
      params.push(filter.folderId);
    }
    const rows = this.db
      .prepare(
        `SELECT ${MEETING_CARD_COLUMNS}
           FROM meeting m
           LEFT JOIN note n ON n.owner_id = m.owner_id AND n.meeting_id = m.id
           LEFT JOIN folder f ON f.owner_id = n.owner_id AND f.id = n.folder_id
          WHERE ${where}
          ORDER BY m.scheduled_start_at DESC, m.id
          LIMIT ${String(LIST_LIMIT)}`,
      )
      .all(...params);
    return Promise.resolve(rows.map(toMeetingListItem));
  }

  create(
    ownerId: string,
    record: NewMeetingRecord,
    submissionKey: string,
  ): Promise<{ meetingId: string; created: boolean }> {
    const now = this.clock.now().toISOString();
    return settle(() =>
      inTransaction(this.db, () => {
        const seen = this.db
          .prepare(
            "SELECT resource_id FROM idempotency_key WHERE owner_id = ? AND scope = ? AND key = ?",
          )
          .get(ownerId, CREATE_SCOPE, submissionKey);
        const previous = text(seen?.["resource_id"]);
        if (previous !== null) return { meetingId: previous, created: false };

        const meetingId = this.ids.newId();
        this.db
          .prepare(
            `INSERT INTO meeting (id, owner_id, status, title, agenda, scheduled_start_at, scheduled_end_at,
                                timezone, template_id, created_at, updated_at)
           VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            meetingId,
            ownerId,
            record.title,
            record.agenda,
            record.startsAt,
            record.endsAt,
            record.timezone,
            record.templateId,
            now,
            now,
          );
        for (const attendee of record.attendees)
          this.insertAttendee(ownerId, meetingId, attendee, now);
        this.audit(ownerId, meetingId, "owner", { source: "manual" }, now);
        reindexMeetingRow(this.db, ownerId, meetingId);
        this.db
          .prepare(
            `INSERT INTO idempotency_key (owner_id, scope, key, resource_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            ownerId,
            CREATE_SCOPE,
            submissionKey,
            meetingId,
            now,
            new Date(this.clock.now().getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
          );
        return { meetingId, created: true };
      }),
    );
  }

  upsertFromCalendar(ownerId: string, event: CalendarEvent): Promise<ImportOutcome> {
    const now = this.clock.now().toISOString();
    return settle(() =>
      inTransaction(this.db, (): ImportOutcome => {
        const existing = this.db
          .prepare(
            `SELECT id, status FROM meeting
            WHERE owner_id = ? AND calendar_provider = ? AND provider_event_id = ?`,
          )
          .get(ownerId, event.provider, event.providerEventId);

        if (existing) {
          const meetingId = String(existing["id"]);
          // A meeting being deleted is never touched again, even by a fresh import.
          if (existing["status"] === "deleting") return { meetingId, created: false };
          this.db
            .prepare(
              `UPDATE meeting SET title = ?, scheduled_start_at = ?, scheduled_end_at = ?, timezone = ?, updated_at = ?
              WHERE owner_id = ? AND id = ?`,
            )
            .run(
              event.title,
              event.startsAt,
              event.endsAt,
              event.timezone,
              now,
              ownerId,
              meetingId,
            );
          this.mergeAttendees(ownerId, meetingId, event.attendees, now);
          reindexMeetingRow(this.db, ownerId, meetingId);
          return { meetingId, created: false };
        }

        const meetingId = this.ids.newId();
        this.db
          .prepare(
            `INSERT INTO meeting (id, owner_id, status, title, scheduled_start_at, scheduled_end_at, timezone,
                                calendar_provider, provider_event_id, created_at, updated_at)
           VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            meetingId,
            ownerId,
            event.title,
            event.startsAt,
            event.endsAt,
            event.timezone,
            event.provider,
            event.providerEventId,
            now,
            now,
          );
        this.mergeAttendees(ownerId, meetingId, event.attendees, now);
        this.audit(ownerId, meetingId, "owner", { source: "calendar" }, now);
        reindexMeetingRow(this.db, ownerId, meetingId);
        return { meetingId, created: true };
      }),
    );
  }

  findDetail(ownerId: string, meetingId: string): Promise<MeetingDetail | null> {
    const r = this.db
      .prepare(
        `SELECT id, title, status, agenda, rough_notes, scheduled_start_at, scheduled_end_at, timezone,
                consent_confirmed_at, capture_started_at, updated_at
           FROM meeting
          WHERE owner_id = ? AND id = ? AND status NOT IN ('deleting', 'deleted')`,
      )
      .get(ownerId, meetingId);
    if (!r) return Promise.resolve(null);
    const attendees = this.db
      .prepare(
        "SELECT name, email FROM attendee WHERE owner_id = ? AND meeting_id = ? ORDER BY created_at, name",
      )
      .all(ownerId, meetingId)
      .map((a) => ({ name: String(a["name"]), email: text(a["email"]) }));
    return Promise.resolve({
      id: String(r["id"]),
      title: String(r["title"]),
      status: String(r["status"]) as MeetingStatus,
      agenda: text(r["agenda"]),
      roughNotes: text(r["rough_notes"]) ?? "",
      scheduledStartAt: String(r["scheduled_start_at"]),
      scheduledEndAt: text(r["scheduled_end_at"]),
      timezone: String(r["timezone"]),
      attendees,
      consentConfirmedAt: text(r["consent_confirmed_at"]),
      captureStartedAt: text(r["capture_started_at"]),
      updatedAt: String(r["updated_at"]),
    });
  }

  saveRoughNotes(
    ownerId: string,
    meetingId: string,
    notes: string,
    now: Date,
  ): Promise<Result<{ savedAt: string }, "not_found">> {
    const savedAt = now.toISOString();
    // Only rough_notes and updated_at: consent, status and capture state are never touched here.
    return settle(() =>
      inTransaction(this.db, () => {
        const result = this.db
          .prepare(
            `UPDATE meeting SET rough_notes = ?, updated_at = ?
              WHERE owner_id = ? AND id = ? AND status NOT IN ('deleting', 'deleted')`,
          )
          .run(notes, savedAt, ownerId, meetingId);
        if (Number(result.changes) !== 1) return err("not_found" as const);
        reindexMeetingRow(this.db, ownerId, meetingId);
        return ok({ savedAt });
      }),
    );
  }

  /** Adds attendees that are not on the meeting yet; never removes or duplicates any. */
  private mergeAttendees(
    ownerId: string,
    meetingId: string,
    attendees: Attendee[],
    now: string,
  ): void {
    for (const attendee of attendees) {
      const present =
        attendee.email === null
          ? this.db
              .prepare(
                `SELECT 1 AS x FROM attendee
                  WHERE owner_id = ? AND meeting_id = ? AND email IS NULL AND name = ?`,
              )
              .get(ownerId, meetingId, attendee.name)
          : this.db
              .prepare(
                "SELECT 1 AS x FROM attendee WHERE owner_id = ? AND meeting_id = ? AND email = ?",
              )
              .get(ownerId, meetingId, attendee.email);
      if (!present) this.insertAttendee(ownerId, meetingId, attendee, now);
    }
  }

  private insertAttendee(
    ownerId: string,
    meetingId: string,
    attendee: Attendee,
    now: string,
  ): void {
    this.db
      .prepare(
        "INSERT INTO attendee (id, owner_id, meeting_id, name, email, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(this.ids.newId(), ownerId, meetingId, attendee.name, attendee.email, now);
  }

  private audit(
    ownerId: string,
    meetingId: string,
    actor: "owner" | "system",
    detail: Record<string, string>,
    now: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_event (id, owner_id, meeting_id, kind, actor, detail_json, occurred_at)
         VALUES (?, ?, ?, 'meeting.created', ?, ?, ?)`,
      )
      .run(this.ids.newId(), ownerId, meetingId, actor, JSON.stringify(detail), now);
  }
}
