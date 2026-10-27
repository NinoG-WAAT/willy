/** Idle expiry slides with activity; absolute expiry never moves (OWASP A07). */
export const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
/** Do not write last_seen on every request: at most once per interval. */
export const TOUCH_INTERVAL_MS = 60 * 1000;

export interface SessionTimes {
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
}

export type SessionState = "active" | "idle_expired" | "absolute_expired" | "revoked";

export function startSession(now: Date): SessionTimes {
  return {
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    idleExpiresAt: new Date(now.getTime() + IDLE_TIMEOUT_MS).toISOString(),
    absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS).toISOString(),
    revokedAt: null,
  };
}

export function sessionState(session: SessionTimes, now: Date): SessionState {
  if (session.revokedAt !== null) return "revoked";
  const t = now.getTime();
  if (t >= Date.parse(session.absoluteExpiresAt)) return "absolute_expired";
  if (t >= Date.parse(session.idleExpiresAt)) return "idle_expired";
  return "active";
}

/** New times after activity, or null when the last write is recent enough to skip. */
export function touchedTimes(
  session: SessionTimes,
  now: Date,
): { lastSeenAt: string; idleExpiresAt: string } | null {
  if (now.getTime() - Date.parse(session.lastSeenAt) < TOUCH_INTERVAL_MS) return null;
  const idle = Math.min(now.getTime() + IDLE_TIMEOUT_MS, Date.parse(session.absoluteExpiresAt));
  return { lastSeenAt: now.toISOString(), idleExpiresAt: new Date(idle).toISOString() };
}
