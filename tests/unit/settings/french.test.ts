import { describe, expect, it } from "vitest";
import { settingsNotice } from "../../../src/app/settings/notices";
import { describeDeletion } from "../../../src/domain/settings/deletion-status";
import {
  describeProviders,
  summarizeErrorCode,
} from "../../../src/domain/settings/provider-status";
import {
  describeNoteRetention,
  describeRawAudioRetention,
  parseRetention,
} from "../../../src/domain/settings/retention";
import {
  describeVocabularyStatus,
  limitMessage,
  parseTerms,
  planAddition,
} from "../../../src/domain/transcription/vocabulary";
import { inLocale } from "../../support/locale";

// Settings screens in French (#121): retention, provider status, deletion progress, notices and
// the vocabulary messages. English is covered by the tests of each module.

const NBSP = " ";

describe("retention wording in French", () => {
  it("says it with the right plural", () => {
    const fr = (hours: number) => inLocale("fr", () => describeRawAudioRetention(hours));
    expect(fr(0)).toBe("Supprimer juste après une transcription réussie (par défaut)");
    expect(fr(24)).toBe("Conserver 1 jour après la transcription");
    expect(fr(72)).toBe("Conserver 3 jours après la transcription");
    expect(fr(1)).toBe("Conserver 1 heure après la transcription");
    expect(fr(5)).toBe("Conserver 5 heures après la transcription");
    const notes = (days: number | null) => inLocale("fr", () => describeNoteRetention(days));
    expect(notes(null)).toBe(
      "Conserver les notes et les transcriptions jusqu’à ce que vous les supprimiez (par défaut)",
    );
    expect(notes(1)).toBe("Supprimer définitivement les réunions 1 jour après leur début prévu");
    expect(notes(90)).toBe("Supprimer définitivement les réunions 90 jours après leur début prévu");
  });

  it("reports form mistakes in French, each on its own field", () => {
    const result = inLocale("fr", () =>
      parseRetention(
        { rawAudioRetentionHours: "13", noteRetentionDays: "7", acknowledged: false },
        { rawAudioRetentionHours: 0, noteRetentionDays: null },
      ),
    );
    expect(result).toEqual({
      ok: false,
      error: [
        {
          field: "raw_audio_retention_hours",
          message: "Choisissez dans la liste la durée de conservation de l’audio brut.",
        },
        {
          field: "note_retention_days",
          message: "Choisissez dans la liste la durée de conservation des notes.",
        },
      ],
    });
    const unacknowledged = inLocale("fr", () =>
      parseRetention(
        { rawAudioRetentionHours: "0", noteRetentionDays: "90", acknowledged: false },
        { rawAudioRetentionHours: 0, noteRetentionDays: null },
      ),
    );
    expect(unacknowledged).toEqual({
      ok: false,
      error: [
        {
          field: "acknowledge_note_retention",
          message:
            "Cochez la case pour confirmer que les réunions plus anciennes seront supprimées définitivement.",
        },
      ],
    });
  });
});

describe("provider status in French", () => {
  const modes = {
    calendar: "fake",
    speech_to_text: "deepgram",
    summaries: "misconfigured",
    storage: "local",
  } as const;

  it("names each provider, its state and its mode in French, and never translates a provider's name", () => {
    const [calendar, stt, summaries, storage] = inLocale("fr", () =>
      describeProviders(modes, [{ code: "stt_timeout", at: "2026-11-03T08:00:00.000Z" }]),
    );
    expect(calendar).toMatchObject({
      label: "Calendrier",
      stateText: "Mode simulé",
      modeText: `Mode simulé${NBSP}: un substitut déterministe, aucun vrai fournisseur n’est appelé`,
    });
    expect(stt).toMatchObject({
      label: "Reconnaissance vocale",
      stateText: "Dégradé",
      modeText: `Fournisseur${NBSP}: deepgram`,
      lastError: {
        code: "stt_timeout",
        summary: "La reconnaissance vocale n’a pas répondu à temps.",
      },
    });
    expect(summaries).toMatchObject({
      label: "Résumés (LLM)",
      stateText: "À configurer",
      modeText: "La configuration est incomplète ou invalide",
    });
    expect(storage).toMatchObject({
      label: "Stockage audio",
      stateText: "Configuré",
      modeText: "Disque local",
    });
  });

  it("shows an error code as a code and says in French when it is unknown or not plain", () => {
    expect(inLocale("fr", () => summarizeErrorCode("llm_unavailable"))).toEqual({
      code: "llm_unavailable",
      summary: "Le service de résumé est indisponible.",
    });
    expect(inLocale("fr", () => summarizeErrorCode("stt_new_failure"))).toEqual({
      code: "stt_new_failure",
      summary: "Le fournisseur a signalé un problème.",
    });
    // A provider message or a URL is never echoed, in any language.
    const redacted = inLocale("fr", () => summarizeErrorCode("https://secret.example/?token=abc"));
    expect(redacted).toEqual({
      code: "unrecognized",
      summary: "Le fournisseur a signalé un problème.",
    });
  });
});

describe("deletion progress in French", () => {
  const base = { attempts: 0, maxAttempts: 5, nextRunAt: null, lastErrorCode: null } as const;

  it("labels and explains each state, so the page and the live update say the same thing", () => {
    const view = (job: Parameters<typeof describeDeletion>[0]) =>
      inLocale("fr", () => describeDeletion(job));
    expect(view({ ...base, status: "pending" })).toMatchObject({
      label: "En attente",
      detail:
        "La réunion est déjà masquée. La suppression de ses fichiers et de ses données n’a pas encore commencé.",
    });
    expect(view({ ...base, status: "running" })).toMatchObject({ label: "Suppression en cours" });
    expect(view({ ...base, status: "succeeded" })).toMatchObject({
      label: "Supprimée",
      detail: "La note, la transcription, l’audio et les entrées de recherche ont disparu.",
    });
  });

  it("puts the numbers and the error code into the French sentence", () => {
    const retrying = inLocale("fr", () =>
      describeDeletion({
        ...base,
        status: "retrying",
        attempts: 2,
        lastErrorCode: "storage_timeout",
      }),
    );
    expect(retrying.label).toBe("Nouvelle tentative");
    expect(retrying.detail).toBe(
      "La tentative 2 sur 5 n’a pas abouti (storage_timeout). Une nouvelle tentative aura lieu automatiquement.",
    );
    const failed = inLocale("fr", () =>
      describeDeletion({
        ...base,
        status: "failed",
        attempts: 5,
        lastErrorCode: "storage_rejected",
      }),
    );
    expect(failed).toMatchObject({ label: "Échec", canRetry: true });
    expect(failed.detail).toBe(
      "La suppression s’est arrêtée après 5 tentatives (storage_rejected). La réunion reste masquée. Elle sera relancée automatiquement dans l’heure, ou vous pouvez réessayer maintenant.",
    );
    // Without a code there are no empty parentheses.
    const noCode = inLocale("fr", () =>
      describeDeletion({ ...base, status: "failed", attempts: 1 }),
    );
    expect(noCode.detail).toContain("après 1 tentative. La réunion");
  });
});

describe("notices in French", () => {
  it.each([
    ["language_saved", "Langue enregistrée."],
    ["retention_saved", "Paramètres de conservation enregistrés."],
    [
      "deletion_repeated",
      "Cette suppression a déjà été demandée. Sa progression est affichée ci-dessous.",
    ],
    ["vocabulary_removed", "Mot retiré."],
  ])("%s", (code, text) => {
    expect(inLocale("fr", () => settingsNotice(code))).toBe(text);
  });

  it("an unknown code, or one that is a property name of the table, shows nothing in any language", () => {
    for (const code of [null, "", "nope", "toString", "__proto__", "constructor"]) {
      expect(inLocale("fr", () => settingsNotice(code))).toBeNull();
      expect(settingsNotice(code)).toBeNull();
    }
  });
});

describe("vocabulary messages in French", () => {
  it("explains what was refused, quoting the word with French quotation marks", () => {
    const messages = (raw: string): string[] => {
      const parsed = inLocale("fr", () => parseTerms(raw));
      if (parsed.ok) throw new Error("expected a refusal");
      return parsed.error.map((e) => e.message);
    };
    expect(messages("")).toEqual(["Saisissez au moins un mot."]);
    expect(messages("-flag, ok\u0007bad")).toEqual([
      `«${NBSP}-flag${NBSP}» ne peut pas commencer par un tiret.`,
      `«${NBSP}ok\u0007bad${NBSP}» contient un caractère qui ne peut pas figurer dans un mot.`,
    ]);
    expect(messages("x".repeat(81))[0]).toBe(
      `«${NBSP}${"x".repeat(29)}…${NBSP}» est trop long${NBSP}: un mot peut compter 80 caractères au maximum.`,
    );
  });

  it("says when the list is full, and nothing was added", () => {
    expect(inLocale("fr", () => limitMessage(199, 3))).toBe(
      `Vous pouvez conserver 200 mots au maximum et vous en avez 199. En ajouter 3 de plus dépasserait la limite${NBSP}; rien n’a été ajouté.`,
    );
    const existing = Array.from({ length: 200 }, (_, i) => `mot${String(i)}`);
    const plan = inLocale("fr", () => planAddition(existing, "nouveau"));
    expect(plan.ok).toBe(false);
  });

  it("counts the words the speech recogniser reads, with the French plural", () => {
    const status = (total: number, used: number) =>
      inLocale("fr", () => describeVocabularyStatus(total, used));
    expect(status(1, 1)).toBe("1 mot sur 1 est utilisé par le moteur de reconnaissance vocale.");
    expect(status(5, 5)).toBe("5 mots sur 5 sont utilisés par le moteur de reconnaissance vocale.");
    expect(status(3, 2)).toBe(
      "2 mots sur 3 sont utilisés par le moteur de reconnaissance vocale. 1 ne tient pas et est exclu.",
    );
    expect(status(60, 40)).toBe(
      "40 mots sur 60 sont utilisés par le moteur de reconnaissance vocale. 20 ne tiennent pas et sont exclus.",
    );
    expect(status(0, 0)).toBe("");
  });
});
