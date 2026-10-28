export type ProviderId = "calendar" | "speech_to_text" | "summaries" | "storage";

export type ProviderState = "configured" | "degraded" | "fake" | "misconfigured";

/** A failure currently affecting the owner's jobs: only a redacted code and when it happened. */
export interface ProviderIssue {
  code: string;
  at: string | null;
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  state: ProviderState;
  /** Words for the state: status is never colour alone. */
  stateText: string;
  modeText: string;
  lastError: { code: string; summary: string; at: string | null } | null;
}

const ORDER: { id: ProviderId; label: string }[] = [
  { id: "calendar", label: "Calendar" },
  { id: "speech_to_text", label: "Speech-to-text" },
  { id: "summaries", label: "Summaries (LLM)" },
  { id: "storage", label: "Audio storage" },
];

const PREFIXES: [string, ProviderId][] = [
  ["stt_", "speech_to_text"],
  ["llm_", "summaries"],
  ["storage_", "storage"],
  ["calendar_", "calendar"],
];

/** The plain, lowercase codes jobs record; anything else is never shown. */
const PLAIN_CODE = /^[a-z][a-z0-9_]{0,39}$/;

export function providerForErrorCode(code: string): ProviderId | null {
  if (!PLAIN_CODE.test(code)) return null;
  return PREFIXES.find(([prefix]) => code.startsWith(prefix))?.[1] ?? null;
}

const SUMMARIES: Readonly<Record<string, string>> = {
  stt_timeout: "Speech-to-text did not answer in time.",
  stt_unavailable: "Speech-to-text is unavailable.",
  stt_rejected: "Speech-to-text rejected the request.",
  stt_rate_limited: "Speech-to-text asked us to slow down.",
  llm_timeout: "The summary service did not answer in time.",
  llm_unavailable: "The summary service is unavailable.",
  llm_rejected: "The summary service rejected the request.",
  llm_rate_limited: "The summary service asked us to slow down.",
  storage_timeout: "Audio storage did not answer in time.",
  storage_unavailable: "Audio storage is unavailable.",
  storage_rejected: "Audio storage rejected the request.",
  storage_rate_limited: "Audio storage asked us to slow down.",
  calendar_not_connected: "Your calendar is not connected, so events cannot be imported.",
  calendar_unavailable: "The calendar could not be reached.",
};

/**
 * Redaction for display: a job's error code is shown only if it is a plain lowercase code, with a
 * sentence for the known ones. Anything else (a provider message, a URL, a token) becomes
 * "unrecognized": never echoed.
 */
export function summarizeErrorCode(code: string): { code: string; summary: string } {
  if (!PLAIN_CODE.test(code)) {
    return { code: "unrecognized", summary: "The provider reported a problem." };
  }
  return { code, summary: SUMMARIES[code] ?? "The provider reported a problem." };
}

const STATE_TEXT: Readonly<Record<ProviderState, string>> = {
  configured: "Configured",
  degraded: "Degraded",
  fake: "Fake mode",
  misconfigured: "Needs configuration",
};

const KNOWN_MODE = /^[a-z0-9][a-z0-9_-]{0,29}$/;

function modeText(mode: string): string {
  if (mode === "fake") return "Fake mode: a deterministic stand-in, no real provider is called";
  if (mode === "misconfigured") return "The configuration is incomplete or invalid";
  if (mode === "local") return "Local disk";
  return KNOWN_MODE.test(mode) ? `Provider: ${mode}` : "Provider: unknown";
}

/**
 * Honest status per provider. A broken configuration outranks everything; otherwise failing jobs
 * make it degraded (even in fake mode, whose mode text still says so); otherwise fake or
 * configured. Only redacted codes and times are carried.
 */
export function describeProviders(
  modes: Readonly<Record<ProviderId, string>>,
  issues: readonly ProviderIssue[],
): ProviderStatus[] {
  return ORDER.map(({ id, label }) => {
    const mode = modes[id];
    const mine = issues
      .filter((issue) => providerForErrorCode(issue.code) === id)
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    const latest = mine[0];
    const state: ProviderState =
      mode === "misconfigured"
        ? "misconfigured"
        : latest
          ? "degraded"
          : mode === "fake"
            ? "fake"
            : "configured";
    return {
      id,
      label,
      state,
      stateText: STATE_TEXT[state],
      modeText: modeText(mode),
      lastError: latest ? { ...summarizeErrorCode(latest.code), at: latest.at } : null,
    };
  });
}
