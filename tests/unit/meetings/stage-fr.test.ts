import { describe, expect, it } from "vitest";
import { navLinks } from "../../../src/components/nav-current";
import { consentLabel, describeMeeting } from "../../../src/domain/meetings/home";
import type { MeetingStatus } from "../../../src/domain/meetings/lifecycle";
import {
  headerAction,
  headerChips,
  stageFor,
  statusLabel,
} from "../../../src/domain/meetings/stage";
import { cardProgress } from "../../../src/domain/progress/text";
import type { MeetingListItem } from "../../../src/ports/meeting-list";
import { inLocale } from "../../support/locale";

const NBSP = " ";

const ALL: MeetingStatus[] = [
  "scheduled",
  "capturing",
  "paused",
  "processing",
  "review",
  "published",
  "failed",
  "archived",
  "deleting",
  "deleted",
];

function item(overrides: Partial<MeetingListItem> = {}): MeetingListItem {
  return {
    id: "m1",
    title: "Point hebdo",
    status: "scheduled",
    scheduledStartAt: "2026-11-04T09:00:00.000Z",
    scheduledEndAt: "2026-11-04T09:30:00.000Z",
    timezone: "Europe/Paris",
    calendarProvider: null,
    consentConfirmedAt: null,
    attendeeCount: 0,
    folderName: null,
    noteStatus: null,
    ...overrides,
  };
}

describe("status words in French", () => {
  it.each([
    ["scheduled", "Planifiée"],
    ["capturing", "Enregistrement en cours"],
    ["paused", "Enregistrement en pause"],
    ["processing", "Traitement"],
    ["review", "Brouillon"],
    ["published", "Publiée"],
    ["failed", "Attention requise"],
    ["archived", "Archivée"],
    ["deleting", "Indisponible"],
  ] as const)("%s reads %s", (status, label) => {
    expect(inLocale("fr", () => statusLabel(status))).toBe(label);
  });

  it("has a French word for every status (strict mode throws otherwise)", () => {
    for (const status of ALL) {
      expect(inLocale("fr", () => statusLabel(status)).length).toBeGreaterThan(0);
    }
  });

  it("leaves English untouched when the request is English", () => {
    expect(inLocale("en", () => statusLabel("review"))).toBe("Draft");
  });
});

describe("the stepper in French", () => {
  it("names the steps, their state and the summary in French, one sentence each", () => {
    const stage = inLocale("fr", () => stageFor("review"));
    if (stage.kind !== "flow") throw new Error("expected a flow");
    expect(stage.steps.map((s) => s.label)).toEqual([
      "Planifiée",
      "Enregistrement",
      "Traitement",
      "Brouillon",
      "Publiée",
    ]);
    expect(stage.steps.map((s) => s.stateText)).toEqual([
      "Terminée",
      "Terminée",
      "Terminée",
      "Étape en cours",
      "À venir",
    ]);
    expect(stage.position).toBe("Étape 4 sur 5");
    expect(stage.summary).toBe(`Étape 4 sur 5${NBSP}: Brouillon`);
  });

  it("says paused and needs attention inside the same sentence", () => {
    const paused = inLocale("fr", () => stageFor("paused"));
    const failed = inLocale("fr", () => stageFor("failed"));
    if (paused.kind !== "flow" || failed.kind !== "flow") throw new Error("expected a flow");
    expect(paused.summary).toBe(`Étape 2 sur 5${NBSP}: Enregistrement, en pause`);
    expect(failed.summary).toBe(`Étape 3 sur 5${NBSP}: Traitement, attention requise`);
    expect(failed.steps[2]?.stateText).toBe("Attention requise");
  });

  it("labels an archived note", () => {
    expect(inLocale("fr", () => stageFor("archived"))).toEqual({
      kind: "archived",
      label: "Archivée",
    });
  });
});

describe("the header action and chips in French", () => {
  const ctx = { meetingId: "m1", noteStatus: null, consentConfirmed: false } as const;

  it("translates the one action of each stage", () => {
    expect(inLocale("fr", () => headerAction("live", "scheduled", ctx))?.label).toBe(
      "Démarrer l’enregistrement",
    );
    expect(inLocale("fr", () => headerAction("live", "review", ctx))?.label).toBe(
      "Ouvrir le brouillon",
    );
    expect(inLocale("fr", () => headerAction("live", "failed", ctx))?.label).toBe(
      "Voir ce qui s’est passé et réessayer",
    );
    expect(inLocale("fr", () => headerAction("live", "published", ctx))?.label).toBe(
      "Ouvrir la note publiée",
    );
    expect(
      inLocale("fr", () => headerAction("review", "review", { ...ctx, noteStatus: "draft" }))
        ?.label,
    ).toBe("Publier dans un dossier");
    expect(
      inLocale("fr", () => headerAction("review", "published", { ...ctx, noteStatus: "published" }))
        ?.label,
    ).toBe("Rouvrir pour modifier");
  });

  it("puts the owner's own folder and template names inside the French sentence, untouched", () => {
    const chips = inLocale("fr", () =>
      headerChips({
        noteStatus: "published",
        folder: { id: "f1", name: "Clients" },
        template: { id: "t1", name: "Appel client" },
      }),
    );
    expect(chips.map((c) => c.label)).toEqual([
      `Dossier${NBSP}: Clients`,
      `Modèle${NBSP}: Appel client`,
    ]);
  });
});

describe("the note card in French", () => {
  it("translates the action, the label and the consent line, never the title", () => {
    const review = inLocale("fr", () => describeMeeting(item({ status: "review" })));
    expect(review.label).toBe("Brouillon");
    expect(review.actionLabel).toBe("Relire la note");
    expect(inLocale("fr", () => describeMeeting(item({ status: "scheduled" })).actionLabel)).toBe(
      "Démarrer la note",
    );
    expect(inLocale("fr", () => consentLabel(item()))).toBe(
      "Votre confirmation du consentement est encore nécessaire avant l’enregistrement",
    );
    expect(
      inLocale("fr", () => consentLabel(item({ consentConfirmedAt: "2026-11-04T08:00:00Z" }))),
    ).toBe("Vous avez confirmé le consentement");
  });

  it("names the folder a published note is filed in, with the folder name as given", () => {
    const published = inLocale("fr", () =>
      describeMeeting(item({ status: "published", folderName: "Clients" })),
    );
    expect(published.label).toBe("Publiée dans Clients");
  });

  it("announces a settled card in French when the progress script updates it", () => {
    const view = inLocale("fr", () =>
      cardProgress(
        {
          meetingStatus: "review",
          job: null,
          summary: null,
          regeneration: null,
          chunks: null,
        },
        "Point hebdo",
        "m1",
      ),
    );
    expect(view.announce).toBe(`Point hebdo${NBSP}: statut passé à «${NBSP}brouillon${NBSP}».`);
    expect(view.fields["label"]).toBe("Brouillon");
  });
});

describe("the navigation in French", () => {
  it("translates every link and keeps the paths", () => {
    expect(inLocale("fr", () => navLinks())).toEqual([
      { href: "/", label: "Réception" },
      { href: "/notes", label: "Toutes les notes" },
      { href: "/search", label: "Rechercher" },
      { href: "/folders", label: "Dossiers" },
      { href: "/settings/templates", label: "Modèles" },
      { href: "/settings", label: "Paramètres" },
    ]);
  });

  it("is computed per call, so two requests in two languages do not share words", () => {
    const fr = inLocale("fr", () => navLinks()[0]?.label);
    const en = inLocale("en", () => navLinks()[0]?.label);
    expect([fr, en]).toEqual(["Réception", "Inbox"]);
  });
});
