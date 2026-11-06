import { describe, expect, it } from "vitest";
import {
  describeJob,
  processingProgress,
  regenerationProgress,
  stoppedMessage,
  type JobProgress,
  type ProcessingPayload,
} from "../../../src/domain/progress/text";
import { inLocale } from "../../support/locale";

const job = (over: Partial<JobProgress> = {}): JobProgress => ({
  status: "running",
  attempts: 1,
  maxAttempts: 5,
  nextRunAt: null,
  lastErrorCode: null,
  ...over,
});
const payload = (over: Partial<ProcessingPayload> = {}): ProcessingPayload => ({
  meetingStatus: "processing",
  job: job(),
  summary: null,
  regeneration: null,
  chunks: null,
  ...over,
});

describe("describeJob in French", () => {
  it.each([
    [null, "Pas encore démarré"],
    [job({ status: "pending" }), "En attente de démarrage"],
    [job({ status: "running" }), "En cours"],
    [job({ status: "retrying", attempts: 2 }), "Nouvel essai (tentative 2 sur 5)"],
    [job({ status: "failed", attempts: 5 }), "Échec après 5 tentatives"],
    [job({ status: "failed", attempts: 1 }), "Échec après 1 tentative"],
    [
      job({ status: "failed", attempts: 5, lastErrorCode: "llm_unavailable" }),
      "Échec après 5 tentatives (llm_unavailable)",
    ],
    [job({ status: "succeeded" }), "Terminée"],
  ])("%j -> %s", (progress, expected) => {
    expect(inLocale("fr", () => describeJob(progress))).toBe(expected);
  });
});

describe("processing and regeneration lines in French", () => {
  it("writes the transcript and summary lines and the outcome as whole sentences", () => {
    const view = inLocale("fr", () =>
      processingProgress(payload({ meetingStatus: "review", job: job({ status: "succeeded" }) })),
    );
    expect(view.fields["transcript"]).toBe("Transcription : Terminée");
    expect(view.fields["summary"]).toBe("Résumé : Pas encore démarré");
    expect(view.fields["outcome"]).toBe(
      "Votre brouillon est prêt. Utilisez « Vérifier à nouveau » pour l’ouvrir.",
    );
  });

  it("keeps the rough notes reassurance when processing failed", () => {
    const view = inLocale("fr", () =>
      processingProgress(payload({ meetingStatus: "failed" }), true),
    );
    expect(view.fields["outcome"]).toBe(
      "Le traitement ne s’est pas terminé. Vos notes brutes sont conservées.",
    );
  });

  it("says what happened to a regeneration", () => {
    const regeneration = { ...job({ status: "failed", attempts: 3 }), sectionId: null };
    const view = inLocale("fr", () => regenerationProgress(payload({ regeneration }), null));
    expect(view.fields["text"]).toBe("Régénération : Échec après 3 tentatives.");
    expect(view.fields["outcome"]).toContain("Votre brouillon précédent est conservé.");
  });

  it("explains why live updates stopped", () => {
    expect(inLocale("fr", () => stoppedMessage("timeout"))).toBe(
      "Les mises à jour en direct se sont arrêtées au bout d’un moment. Utilisez « Vérifier à nouveau » pour voir la dernière version.",
    );
  });
});
