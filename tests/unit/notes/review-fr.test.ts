import { describe, expect, it } from "vitest";
import { actionItemChips } from "../../../src/domain/notes/action-chips";
import { sourceLabel } from "../../../src/domain/notes/outline";
import {
  normalizeActionItemInput,
  normalizeDecisionText,
  normalizeSectionBody,
  normalizeSpeakerName,
  parseLinePositions,
} from "../../../src/domain/notes/review";
import { transcriptSummary } from "../../../src/domain/notes/transcript-panel";
import { inLocale } from "../../support/locale";

const NOW = new Date("2026-11-02T09:00:00.000Z");
const chips = (over: Partial<Parameters<typeof actionItemChips>[0]> = {}) =>
  inLocale("fr", () =>
    actionItemChips(
      { status: "open", assigneeId: null, dueAt: null, dueTimezone: null, ...over },
      { now: NOW, meetingTimezone: "Europe/Paris", attendeeNames: new Map([["a1", "Ada"]]) },
    ),
  );

describe("action item chips in French", () => {
  it("writes the due day with French weekday and month", () => {
    expect(chips({ dueAt: "2026-11-05T22:59:59.000Z" }).due).toBe("Échéance : jeu. 5 nov.");
  });

  it("adds the year when it is not the current one", () => {
    expect(chips({ dueAt: "2027-01-08T22:59:59.000Z" }).due).toBe("Échéance : ven. 8 janv. 2027");
  });

  it("says overdue and unknown in French, and never translates the attendee's name", () => {
    expect(chips({ dueAt: "2026-10-30T22:59:59.000Z" }).overdue).toBe("En retard");
    expect(chips({ assigneeId: "gone" }).assignee).toBe("Inconnu");
    expect(chips({ assigneeId: "a1" }).assignee).toBe("Ada");
  });
});

describe("transcript panel and source labels in French", () => {
  it("summarises the panel with a French plural", () => {
    const at = (ms: number) => ({ startMs: ms });
    expect(inLocale("fr", () => transcriptSummary([]).text)).toBe("Transcription : aucune ligne");
    expect(inLocale("fr", () => transcriptSummary([at(0)]).text)).toBe(
      "Transcription : 0:00, 1 ligne",
    );
    expect(inLocale("fr", () => transcriptSummary([at(0), at(1_090_000)]).text)).toBe(
      "Transcription : 18:10, 2 lignes",
    );
  });

  it("labels a source range and its fallback", () => {
    const timeOf = (p: number) => (p === 1 ? 130_000 : p === 2 ? 225_000 : undefined);
    expect(inLocale("fr", () => sourceLabel(1, 2, timeOf))).toBe("2:10 à 3:45");
    expect(inLocale("fr", () => sourceLabel(1, 9, timeOf))).toBe("Source dans la transcription");
    expect(inLocale("fr", () => sourceLabel(null, null, timeOf))).toBe(
      "Source dans la transcription",
    );
  });
});

describe("review validation messages in French", () => {
  const errors = (result: { ok: boolean; error?: unknown }) =>
    JSON.stringify(result.ok ? null : result.error);

  it("asks for content and for names in French", () => {
    expect(inLocale("fr", () => errors(normalizeSectionBody("  ")))).toContain(
      "Écrivez quelque chose.",
    );
    expect(inLocale("fr", () => errors(normalizeDecisionText("")))).toContain(
      "Décrivez la décision.",
    );
    expect(inLocale("fr", () => errors(normalizeSpeakerName("", "to")))).toContain(
      "Saisissez un nom.",
    );
  });

  it("states limits with the number, and refuses bad line selections", () => {
    expect(inLocale("fr", () => errors(normalizeSectionBody("x".repeat(20_001))))).toContain(
      "Utilisez 20000 caractères au maximum.",
    );
    expect(inLocale("fr", () => errors(parseLinePositions([])))).toContain(
      "Sélectionnez au moins une ligne.",
    );
    expect(inLocale("fr", () => errors(parseLinePositions(["x"])))).toContain("Rechargez la page");
  });

  it("validates an action item in French", () => {
    const result = inLocale("fr", () =>
      normalizeActionItemInput(
        { text: "", assignee: "", due: "2026-02-31", done: false },
        "Europe/Paris",
      ),
    );
    expect(result.ok ? [] : result.error.map((e) => e.message)).toEqual([
      "Décrivez l’action.",
      "Saisissez une date valide.",
    ]);
  });
});
