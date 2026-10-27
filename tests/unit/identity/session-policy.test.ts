import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  TOUCH_INTERVAL_MS,
  sessionState,
  startSession,
  touchedTimes,
} from "../../../src/domain/identity/session-policy";

const t0 = new Date("2026-10-27T09:00:00.000Z");
const after = (ms: number) => new Date(t0.getTime() + ms);

describe("startSession", () => {
  it("sets idle and absolute expiry from the injected clock", () => {
    const s = startSession(t0);
    expect(s.createdAt).toBe("2026-10-27T09:00:00.000Z");
    expect(s.lastSeenAt).toBe(s.createdAt);
    expect(Date.parse(s.idleExpiresAt) - t0.getTime()).toBe(IDLE_TIMEOUT_MS);
    expect(Date.parse(s.absoluteExpiresAt) - t0.getTime()).toBe(ABSOLUTE_TIMEOUT_MS);
    expect(s.revokedAt).toBeNull();
  });

  it("has an idle timeout shorter than the absolute timeout", () => {
    expect(IDLE_TIMEOUT_MS).toBeLessThan(ABSOLUTE_TIMEOUT_MS);
  });
});

describe("sessionState", () => {
  const s = startSession(t0);

  it("is active inside both windows", () => {
    expect(sessionState(s, after(1000))).toBe("active");
    expect(sessionState(s, after(IDLE_TIMEOUT_MS - 1))).toBe("active");
  });

  it("expires when idle for too long", () => {
    expect(sessionState(s, after(IDLE_TIMEOUT_MS))).toBe("idle_expired");
  });

  it("expires at the absolute limit even if recently active", () => {
    const busy = { ...s, idleExpiresAt: "2099-01-01T00:00:00.000Z" };
    expect(sessionState(busy, after(ABSOLUTE_TIMEOUT_MS))).toBe("absolute_expired");
  });

  it("is revoked once signed out, whatever the clock says", () => {
    expect(sessionState({ ...s, revokedAt: "2026-10-27T09:05:00.000Z" }, after(1000))).toBe(
      "revoked",
    );
  });
});

describe("touchedTimes (sliding idle window)", () => {
  const s = startSession(t0);

  it("does not write again within the touch interval", () => {
    expect(touchedTimes(s, after(TOUCH_INTERVAL_MS - 1))).toBeNull();
  });

  it("slides the idle expiry forward after the interval", () => {
    const now = after(TOUCH_INTERVAL_MS);
    const touched = touchedTimes(s, now);
    expect(touched?.lastSeenAt).toBe(now.toISOString());
    expect(Date.parse(touched?.idleExpiresAt ?? "") - now.getTime()).toBe(IDLE_TIMEOUT_MS);
  });

  it("never slides beyond the absolute expiry", () => {
    const now = after(ABSOLUTE_TIMEOUT_MS - 1000);
    const nearEnd = { ...s, idleExpiresAt: after(ABSOLUTE_TIMEOUT_MS).toISOString() };
    expect(touchedTimes(nearEnd, now)?.idleExpiresAt).toBe(s.absoluteExpiresAt);
  });
});
