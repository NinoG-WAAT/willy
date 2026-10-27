import { normalizeCalendarEvent } from "../../domain/calendar/event";
import { verifyWebhookSignature } from "../../domain/calendar/webhook-signature";
import type { CalendarImportRepository } from "../../ports/calendar-import-repository";
import type { CalendarConnections, ProviderEventStore } from "../../ports/calendar-webhook-stores";

const PROVIDER = "google";

export interface WebhookDeps {
  secret: string;
  now: () => Date;
  events: ProviderEventStore;
  connections: CalendarConnections;
  repo: CalendarImportRepository;
}

export type WebhookResult =
  | { status: "processed"; meetingId: string; created: boolean }
  | { status: "duplicate" }
  | { status: "ignored" }
  | { status: "rejected"; reason: "bad_signature" | "malformed" | "unknown_channel" };

const PAYLOAD_KEYS = new Set(["id", "type", "channelId", "event"]);

function parse(
  rawBody: string,
): { id: string; type: string; channelId: string; event: unknown } | null {
  let data: unknown;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (!Object.keys(record).every((k) => PAYLOAD_KEYS.has(k))) return null;
  const { id, type, channelId } = record;
  const bounded = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= 256;
  if (!bounded(id) || !bounded(type) || !bounded(channelId)) return null;
  return { id, type, channelId, event: record["event"] };
}

/**
 * Inbound provider webhook: verify the signature over the raw body first (A08), validate, resolve
 * the Owner from our own connection records, dedupe by delivery id, then import idempotently.
 */
export async function handleCalendarWebhook(
  deps: WebhookDeps,
  request: { signatureHeader: string | null; rawBody: string },
): Promise<WebhookResult> {
  const signature = await verifyWebhookSignature({
    secret: deps.secret,
    header: request.signatureHeader,
    body: request.rawBody,
    nowSec: Math.floor(deps.now().getTime() / 1000),
  });
  if (!signature.ok) return { status: "rejected", reason: "bad_signature" };

  const payload = parse(request.rawBody);
  if (!payload) return { status: "rejected", reason: "malformed" };

  const upsert = payload.type === "event.upserted";
  let event = null;
  if (upsert) {
    const raw = typeof payload.event === "object" && payload.event !== null ? payload.event : null;
    const normalized = normalizeCalendarEvent(raw === null ? null : { ...raw, provider: PROVIDER });
    if (!normalized.ok) return { status: "rejected", reason: "malformed" };
    event = normalized.value;
  }

  const ownerId = await deps.connections.ownerForChannel(payload.channelId);
  if (ownerId === null) return { status: "rejected", reason: "unknown_channel" };

  if (!(await deps.events.claim(PROVIDER, payload.id))) return { status: "duplicate" };
  if (event === null) return { status: "ignored" };

  try {
    const outcome = await deps.repo.upsertFromCalendar(ownerId, event);
    return { status: "processed", meetingId: outcome.meetingId, created: outcome.created };
  } catch (error) {
    // Let the provider's redelivery be processed instead of being deduplicated into a lost event.
    await deps.events.release(PROVIDER, payload.id);
    throw error;
  }
}
