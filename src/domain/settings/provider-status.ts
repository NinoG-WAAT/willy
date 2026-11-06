import { t } from "../../i18n/translate";
import { PLAIN_CODE, displayableErrorCode } from "./error-code";

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

const ORDER: readonly ProviderId[] = ["calendar", "speech_to_text", "summaries", "storage"];

function providerLabel(id: ProviderId): string {
  switch (id) {
    case "calendar":
      return t("Calendar");
    case "speech_to_text":
      return t("Speech-to-text");
    case "summaries":
      return t("Summaries (LLM)");
    case "storage":
      return t("Audio storage");
  }
}

const PREFIXES: [string, ProviderId][] = [
  ["stt_", "speech_to_text"],
  ["llm_", "summaries"],
  ["storage_", "storage"],
  ["calendar_", "calendar"],
];

export function providerForErrorCode(code: string): ProviderId | null {
  if (!PLAIN_CODE.test(code)) return null;
  return PREFIXES.find(([prefix]) => code.startsWith(prefix))?.[1] ?? null;
}

/** A sentence for the known codes; written per request, so it follows the page language. */
function summaryFor(code: string): string {
  switch (code) {
    case "stt_timeout":
      return t("Speech-to-text did not answer in time.");
    case "stt_unavailable":
      return t("Speech-to-text is unavailable.");
    case "stt_rejected":
      return t("Speech-to-text rejected the request.");
    case "stt_rate_limited":
      return t("Speech-to-text asked us to slow down.");
    case "llm_timeout":
      return t("The summary service did not answer in time.");
    case "llm_unavailable":
      return t("The summary service is unavailable.");
    case "llm_rejected":
      return t("The summary service rejected the request.");
    case "llm_rate_limited":
      return t("The summary service asked us to slow down.");
    case "storage_timeout":
      return t("Audio storage did not answer in time.");
    case "storage_unavailable":
      return t("Audio storage is unavailable.");
    case "storage_rejected":
      return t("Audio storage rejected the request.");
    case "storage_rate_limited":
      return t("Audio storage asked us to slow down.");
    case "calendar_not_connected":
      return t("Your calendar is not connected, so events cannot be imported.");
    case "calendar_unavailable":
      return t("The calendar could not be reached.");
    default:
      return t("The provider reported a problem.");
  }
}

/**
 * Redaction for display: a job's error code is shown only if it is a plain lowercase code, with a
 * sentence for the known ones. Anything else (a provider message, a URL, a token) becomes
 * "unrecognized": never echoed.
 */
export function summarizeErrorCode(code: string): { code: string; summary: string } {
  if (!PLAIN_CODE.test(code)) {
    return { code: displayableErrorCode(code), summary: t("The provider reported a problem.") };
  }
  return { code, summary: summaryFor(code) };
}

function stateText(state: ProviderState): string {
  switch (state) {
    case "configured":
      return t("Configured");
    case "degraded":
      return t("Degraded");
    case "fake":
      return t("Fake mode");
    case "misconfigured":
      return t("Needs configuration");
  }
}

const KNOWN_MODE = /^[a-z0-9][a-z0-9_-]{0,29}$/;

function modeText(mode: string): string {
  if (mode === "fake") return t("Fake mode: a deterministic stand-in, no real provider is called");
  if (mode === "misconfigured") return t("The configuration is incomplete or invalid");
  if (mode === "local") return t("Local disk");
  // The provider's own name is never translated.
  return KNOWN_MODE.test(mode) ? t("Provider: {name}", { name: mode }) : t("Provider: unknown");
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
  return ORDER.map((id) => {
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
      label: providerLabel(id),
      state,
      stateText: stateText(state),
      modeText: modeText(mode),
      lastError: latest ? { ...summarizeErrorCode(latest.code), at: latest.at } : null,
    };
  });
}
