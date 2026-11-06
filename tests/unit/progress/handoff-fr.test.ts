import { describe, expect, it } from "vitest";
import { handoffProgress, stayingAnnouncement } from "../../../src/domain/progress/handoff";
import type { JobProgress, ProcessingPayload } from "../../../src/domain/progress/text";
import { inLocale } from "../../support/locale";

const job = (over: Partial<JobProgress> = {}): JobProgress => ({
  status: "running",
  attempts: 1,
  maxAttempts: 5,
  nextRunAt: null,
  lastErrorCode: null,
  ...over,
});
const chunks = (over: Partial<NonNullable<ProcessingPayload["chunks"]>> = {}) => ({
  total: 4,
  uploaded: 0,
  transcribed: 1,
  failed: 0,
  purged: 0,
  ...over,
});
const payload = (over: Partial<ProcessingPayload> = {}): ProcessingPayload => ({
  meetingStatus: "processing",
  job: job(),
  summary: null,
  regeneration: null,
  chunks: chunks(),
  ...over,
});
const fr = (p: ProcessingPayload, options?: { autoOpening?: boolean }) =>
  inLocale("fr", () => handoffProgress(p, options));

describe("the hand-off after Stop, in French", () => {
  it("counts the parts done while transcribing, with a French plural", () => {
    expect(fr(payload()).fields["headline"]).toBe(
      "Enregistrement terminé. Préparation de la transcription.",
    );
    expect(fr(payload()).fields["transcribe"]).toBe("Transcription : 1 sur 4 parties");
    expect(fr(payload({ chunks: chunks({ total: 1, transcribed: 0 }) })).fields["transcribe"]).toBe(
      "Transcription : 0 sur 1 partie",
    );
    expect(fr(payload()).fields["draft"]).toBe(
      "Rédaction du brouillon : En attente de la transcription",
    );
  });

  it("explains retries and failed parts in whole sentences", () => {
    const view = fr(
      payload({
        job: job({ status: "retrying", attempts: 2 }),
        chunks: chunks({ failed: 2 }),
      }),
    );
    expect(view.fields["note"]).toBe(
      "2 parties n’ont pas encore pu être transcrites. " +
        "Nouvel essai automatique (tentative 2 sur 5). Les parties déjà traitées sont conservées.",
    );
  });

  it("announces the draft and its button in French", () => {
    const ready = payload({ meetingStatus: "review", job: job({ status: "succeeded" }) });
    expect(fr(ready).fields["outcome"]).toBe("Votre brouillon est prêt.");
    expect(fr(ready).fields["announce"]).toBe(
      "Brouillon prêt. Utilisez le bouton « Ouvrir le brouillon ».",
    );
    expect(fr(ready, { autoOpening: true }).fields["announce"]).toBe(
      "Brouillon prêt, ouverture en cours.",
    );
    expect(inLocale("fr", stayingAnnouncement)).toBe(fr(ready).fields["announce"]);
  });

  it("says what is kept when processing failed", () => {
    const view = fr(
      payload({ meetingStatus: "failed", chunks: chunks({ failed: 1, transcribed: 2 }) }),
    );
    expect(view.fields["note"]).toBe(
      "1 partie n’a pas pu être transcrite. 2 parties sont conservées.",
    );
    expect(view.fields["announce"]).toContain("Vos notes brutes sont conservées.");
  });
});
