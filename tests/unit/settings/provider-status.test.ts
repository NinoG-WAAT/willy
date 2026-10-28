import { describe, expect, it } from "vitest";
import {
  describeProviders,
  providerForErrorCode,
  summarizeErrorCode,
  type ProviderId,
} from "../../../src/domain/settings/provider-status";

const modes = (over: Partial<Record<ProviderId, string>> = {}): Record<ProviderId, string> => ({
  calendar: "fake",
  speech_to_text: "fake",
  summaries: "fake",
  storage: "local",
  ...over,
});

const byId = (statuses: ReturnType<typeof describeProviders>, id: ProviderId) => {
  const found = statuses.find((s) => s.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

describe("providerForErrorCode", () => {
  it.each([
    ["stt_timeout", "speech_to_text"],
    ["stt_unavailable", "speech_to_text"],
    ["llm_rate_limited", "summaries"],
    ["storage_unavailable", "storage"],
    ["calendar_not_connected", "calendar"],
  ] as const)("%s belongs to %s", (code, provider) => {
    expect(providerForErrorCode(code)).toBe(provider);
  });

  it.each(["internal_error", "conflict", "transcript_unreadable", "", "STT_TIMEOUT", "xstt_a"])(
    "%j does not point at a provider",
    (code) => {
      expect(providerForErrorCode(code)).toBeNull();
    },
  );
});

describe("summarizeErrorCode (redaction)", () => {
  it("explains known codes in words and keeps the code", () => {
    expect(summarizeErrorCode("stt_timeout")).toEqual({
      code: "stt_timeout",
      summary: "Speech-to-text did not answer in time.",
    });
    expect(summarizeErrorCode("storage_rejected").summary).toMatch(/storage/i);
  });

  it("never echoes anything that is not a plain error code", () => {
    for (const hostile of [
      "stt_error sk-live-123456",
      "Bearer abc.def.ghi",
      "https://api.example.test/?key=secret",
      "x".repeat(80),
      "stt timeout",
      "<script>alert(1)</script>",
    ]) {
      const out = summarizeErrorCode(hostile);
      expect(out.code).toBe("unrecognized");
      expect(JSON.stringify(out)).not.toContain("secret");
      expect(JSON.stringify(out)).not.toContain("sk-live");
      expect(JSON.stringify(out)).not.toContain("<script>");
    }
  });

  it("falls back to a generic sentence for an unknown but well-formed code", () => {
    expect(summarizeErrorCode("stt_brand_new")).toEqual({
      code: "stt_brand_new",
      summary: "The provider reported a problem.",
    });
  });
});

describe("describeProviders", () => {
  it("lists calendar, speech-to-text, summaries and storage in that order", () => {
    expect(describeProviders(modes(), []).map((s) => s.id)).toEqual([
      "calendar",
      "speech_to_text",
      "summaries",
      "storage",
    ]);
  });

  it("says fake mode honestly", () => {
    const status = byId(describeProviders(modes(), []), "speech_to_text");
    expect(status.state).toBe("fake");
    expect(status.stateText).toBe("Fake mode");
    expect(status.modeText).toMatch(/fake/i);
    expect(status.lastError).toBeNull();
  });

  it("reports a real, healthy provider as configured and names it", () => {
    const status = byId(
      describeProviders(modes({ speech_to_text: "deepgram" }), []),
      "speech_to_text",
    );
    expect(status).toMatchObject({ state: "configured", stateText: "Configured" });
    expect(status.modeText).toContain("deepgram");
    expect(byId(describeProviders(modes(), []), "storage")).toMatchObject({
      state: "configured",
      modeText: "Local disk",
    });
  });

  it("reports a broken configuration without echoing why", () => {
    const status = byId(describeProviders(modes({ summaries: "misconfigured" }), []), "summaries");
    expect(status.state).toBe("misconfigured");
    expect(status.stateText).toBe("Needs configuration");
  });

  it("marks a provider degraded when its jobs are failing, with the redacted last error", () => {
    const statuses = describeProviders(modes({ speech_to_text: "deepgram" }), [
      { code: "stt_timeout", at: "2026-10-27T09:00:00.000Z" },
      { code: "stt_unavailable", at: "2026-10-27T10:00:00.000Z" },
      { code: "llm_unavailable", at: "2026-10-27T08:00:00.000Z" },
    ]);
    const stt = byId(statuses, "speech_to_text");
    expect(stt.state).toBe("degraded");
    expect(stt.stateText).toBe("Degraded");
    expect(stt.lastError).toEqual({
      code: "stt_unavailable",
      summary: "Speech-to-text is unavailable.",
      at: "2026-10-27T10:00:00.000Z",
    });
    expect(byId(statuses, "summaries").state).toBe("degraded");
    expect(byId(statuses, "storage").state).toBe("configured");
  });

  it("keeps saying fake mode in the text when a fake provider fails", () => {
    const stt = byId(
      describeProviders(modes(), [{ code: "stt_unavailable", at: null }]),
      "speech_to_text",
    );
    expect(stt.state).toBe("degraded");
    expect(stt.modeText).toMatch(/fake/i);
  });

  it("ignores error codes that do not point at a provider", () => {
    const statuses = describeProviders(modes(), [{ code: "internal_error", at: null }]);
    expect(statuses.every((s) => s.lastError === null)).toBe(true);
  });

  it("lets a broken configuration outrank degraded", () => {
    const status = byId(
      describeProviders(modes({ speech_to_text: "misconfigured" }), [
        { code: "stt_timeout", at: null },
      ]),
      "speech_to_text",
    );
    expect(status.state).toBe("misconfigured");
  });

  it("never prints an unknown mode value", () => {
    const status = byId(
      describeProviders(modes({ calendar: "sk-live-abcdef https://x.test" }), []),
      "calendar",
    );
    expect(status.modeText).not.toContain("sk-live");
    expect(status.modeText).not.toContain("https");
  });
});
