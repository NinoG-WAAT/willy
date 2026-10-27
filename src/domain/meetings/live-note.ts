import type { MeetingStatus } from "./lifecycle";

export type LivePhase = "before" | "recording" | "paused" | "after" | "archived" | "gone";

export interface LiveControls {
  phase: LivePhase;
  /** The persistent recording state to show, or null when nothing is being captured. */
  indicator: "recording" | "paused" | null;
  /** The consent statement and its checkbox: only before the first start, until consent is stored. */
  showConsent: boolean;
  consentConfirmed: boolean;
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  /** Rough notes stay editable in every state except deleting: they survive any failure. */
  notesEditable: boolean;
}

const NONE = {
  indicator: null,
  showConsent: false,
  canStart: false,
  canPause: false,
  canResume: false,
  canStop: false,
} as const;

/** What the live note screen offers for a meeting in `status` (table, not scattered ifs). */
export function liveControls(
  status: MeetingStatus,
  consentConfirmedAt: string | null,
): LiveControls {
  const consentConfirmed = consentConfirmedAt !== null;
  const base = { ...NONE, consentConfirmed, notesEditable: true };
  switch (status) {
    case "scheduled":
      return { ...base, phase: "before", showConsent: !consentConfirmed, canStart: true };
    case "capturing":
      return { ...base, phase: "recording", indicator: "recording", canPause: true, canStop: true };
    case "paused":
      return { ...base, phase: "paused", indicator: "paused", canResume: true, canStop: true };
    case "processing":
    case "review":
    case "published":
    case "failed":
      return { ...base, phase: "after" };
    case "archived":
      return { ...base, phase: "archived" };
    case "deleting":
    case "deleted":
      return { ...base, phase: "gone", notesEditable: false };
  }
}
