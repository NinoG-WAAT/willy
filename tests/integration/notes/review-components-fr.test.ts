import { getViteConfig } from "astro/config";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReviewActionItem, ReviewDecision } from "../../../src/ports/review-repository";

/**
 * The review components rendered through Astro's own compiler, in French. The components are
 * loaded through Vite, which makes its own copy of the translation core, so the locale helper is
 * loaded the same way (it then configures that copy).
 */

let server: ViteDevServer;
let container: AstroContainer;
let inLocale: <T>(locale: "en" | "fr", fn: () => T) => T;
const components = new Map<string, Parameters<AstroContainer["renderToString"]>[0]>();

async function render(name: string, props: Record<string, unknown>, locale: "en" | "fr" = "fr") {
  const component = components.get(name);
  if (!component) throw new Error(`component not loaded: ${name}`);
  return inLocale(locale, () => container.renderToString(component, { props }));
}

beforeAll(async () => {
  const config = await getViteConfig({})({ command: "serve", mode: "test" });
  server = await createServer({ ...config, server: { middlewareMode: true }, logLevel: "silent" });
  ({ inLocale } = (await server.ssrLoadModule("/tests/support/locale.ts")) as {
    inLocale: typeof inLocale;
  });
  for (const name of [
    "ReviewActionItems",
    "ReviewDecisions",
    "ReviewMoveFolder",
    "ReviewPublish",
    "ReviewSource",
    "ReviewSpeakers",
    "ReviewSummary",
    "ReviewTranscript",
  ]) {
    const module = (await server.ssrLoadModule(`/src/components/review/${name}.astro`)) as {
      default: Parameters<AstroContainer["renderToString"]>[0];
    };
    components.set(name, module.default);
  }
  container = await AstroContainer.create();
}, 60_000);

afterAll(async () => {
  await server.close();
});

const typed = (_key: string, _name: string, fallback: string) => fallback;
const none = () => [];
const noSource = () => null;
const common = { base: "/meetings/m1/review", csrf: "tok", typed, errorsFor: none };

const action = (over: Partial<ReviewActionItem> = {}): ReviewActionItem => ({
  id: "a1",
  text: "Envoyer le <b>deck</b>",
  assigneeId: "p1",
  dueAt: "2026-11-05T22:59:59.000Z",
  dueTimezone: "Europe/Paris",
  status: "open",
  sourceFrom: null,
  sourceTo: null,
  edited: true,
  ...over,
});

describe("ReviewActionItems in French", () => {
  const props = (over: Record<string, unknown> = {}) => ({
    ...common,
    editable: true,
    actionItems: [action()],
    editingId: null,
    attendees: [{ id: "p1", name: "Ada Lovelace" }],
    timezone: "Europe/Paris",
    now: new Date("2026-11-02T09:00:00.000Z"),
    isHit: () => false,
    sourceLink: noSource,
    checked: (_k: string, _n: string, fallback: boolean) => fallback,
    ...over,
  });

  it("speaks French around the owner's text and escapes it", async () => {
    const html = await render("ReviewActionItems", props());
    expect(html).toContain(">Actions</h2>");
    expect(html).toContain("Échéance : jeu. 5 nov.");
    expect(html).toContain("Modifié par vous");
    expect(html).toContain("Marquer comme terminée : Envoyer le &lt;b&gt;deck&lt;/b&gt;");
    expect(html).toContain("Ajouter une action");
    expect(html).toContain("Date d’échéance (Europe/Paris)");
    expect(html).not.toContain("<b>deck");
    expect(html).not.toMatch(/Action items|Add an action item|Edited by you/);
  });

  it("keeps the owner's attendee names and the empty state in French", async () => {
    const html = await render("ReviewActionItems", props({ actionItems: [] }));
    expect(html).toContain("Aucune action n’a été enregistrée.");
    expect(html).toContain("Ada Lovelace");
  });

  it("names the state of a read-only action in French", async () => {
    const html = await render("ReviewActionItems", props({ editable: false }));
    expect(html).toContain("À faire");
    expect(html).not.toContain("To do");
  });

  it("says overdue in words, in French", async () => {
    const html = await render(
      "ReviewActionItems",
      props({ now: new Date("2026-12-01T09:00:00.000Z") }),
    );
    expect(html).toContain("En retard");
  });

  it("the edit form of an item is in French", async () => {
    const html = await render("ReviewActionItems", props({ editingId: "a1" }));
    expect(html).toContain("Enregistrer l’action");
    expect(html).toContain("Responsable");
    expect(html).toContain("Retirer cette action");
    expect(html).toContain("Annuler");
  });

  it("stays English for an English owner", async () => {
    const html = await render("ReviewActionItems", props(), "en");
    expect(html).toContain(">Action items</h2>");
    expect(html).toContain("Due Thu 5 Nov");
  });
});

describe("ReviewDecisions and ReviewSource in French", () => {
  const decision: ReviewDecision = {
    id: "d1",
    text: "Livrer en novembre",
    sourceFrom: null,
    sourceTo: null,
    edited: false,
  };

  it("labels a decision outline in French, with the owner's text untouched", async () => {
    const html = await render("ReviewDecisions", {
      ...common,
      editable: true,
      decisions: [decision],
      editingId: null,
      isHit: () => true,
      sourceLink: noSource,
    });
    expect(html).toContain(">Décisions</h2>");
    expect(html).toContain("Livrer en novembre");
    expect(html).toContain("Résultat de recherche");
    expect(html).toContain("Ajouter une décision");
    expect(html).toContain("Ajouté par vous : aucune source dans la transcription.");
  });

  it("gives a source link its own French accessible name from the page", async () => {
    const html = await render("ReviewSource", {
      source: {
        label: "Source : transcription de 2:10 à 3:45",
        chip: "2:10 à 3:45",
        href: "#x",
        from: 1,
        to: 2,
      },
      chip: true,
    });
    expect(html).toContain(
      'aria-label="Source&#32;: transcription de 2:10 à 3:45"'.replace("&#32;", " "),
    );
  });
});

describe("ReviewPublish in French", () => {
  const note = {
    id: "n1",
    status: "published" as const,
    revision: 1,
    folderId: "f1",
    folderName: "Board <i>",
    publishedAt: "2026-11-03T08:00:00.000Z",
  };
  const props = (over: Record<string, unknown> = {}) => ({
    ...common,
    editable: false,
    bar: false,
    formOpen: false,
    note,
    meeting: { status: "published", timezone: "Europe/Paris" },
    folders: [{ id: "f1", name: "Board <i>" }],
    ...over,
  });

  it("writes one whole sentence for a published note, with the folder escaped", async () => {
    const html = await render("ReviewPublish", props());
    expect(html).toContain("Publiée dans Board &lt;i&gt; le mar. 3 nov., 09:00 UTC+1.");
    expect(html).toContain("Cette version est en lecture seule.");
    expect(html).toContain("Rouvrir pour modifier");
  });

  it("the sticky bar of a draft is in French", async () => {
    const html = await render(
      "ReviewPublish",
      props({
        bar: true,
        editable: true,
        note: { ...note, status: "draft", folderName: null, publishedAt: null },
      }),
    );
    expect(html).toContain("Brouillon, non publié");
    expect(html).toContain("Publier dans un dossier");
    expect(html).toContain("J’ai relu cette note et je souhaite la publier.");
  });

  it("explains a draft that cannot be published in French", async () => {
    const html = await render(
      "ReviewPublish",
      props({
        note: { ...note, status: "draft" },
        meeting: { status: "archived", timezone: "UTC" },
      }),
    );
    expect(html).toContain("Cette note est archivée.");
  });
});

describe("speakers, transcript, summary and move control in French", () => {
  it("counts lines with a French plural", async () => {
    const html = await render("ReviewSpeakers", {
      ...common,
      editable: true,
      speakers: [
        { name: "Speaker 1", lines: 1 },
        { name: "Speaker 2", lines: 3 },
      ],
      formsOpen: false,
    });
    expect(html).toContain(">Intervenants");
    expect(html).toContain("1 ligne");
    expect(html).toContain("3 lignes");
    expect(html).toContain("Renommer ou fusionner des intervenants");
    // The label the transcriber gave is owner data, never translated.
    expect(html).toContain("Speaker 1");
  });

  it("labels the transcript lines and the assign form in French", async () => {
    const html = await render("ReviewTranscript", {
      segments: [{ id: "s1", position: 0, startMs: 5000, speaker: "Speaker 1", text: null }],
      inSource: () => true,
      open: true,
      summary: "Transcription : 0:05, 1 ligne",
      editable: true,
      base: "/meetings/m1/review",
      csrf: "tok",
    });
    expect(html).toContain("Retour au résumé");
    expect(html).toContain("Attribuer les lignes cochées à");
    expect(html).toContain("Sélectionner la ligne de Speaker 1 à 0:05");
    expect(html).toContain("Citée");
    expect(html).toContain("Cette ligne n’a pas pu être lue.");
  });

  it("renders the summary controls and a section in French", async () => {
    const html = await render("ReviewSummary", {
      ...common,
      meetingId: "m1",
      editable: true,
      sections: [
        {
          id: "s1",
          heading: "Risques",
          body: "- Prix",
          sourceFrom: null,
          sourceTo: null,
          edited: true,
        },
      ],
      editingId: null,
      regeneration: null,
      draftRegeneration: null,
      isHit: () => false,
      sourceLink: noSource,
    });
    expect(html).toContain("Résumé de la réunion");
    expect(html).toContain("Régénérer tout le brouillon");
    expect(html).toContain("Modifié par vous");
    expect(html).toContain("la section Risques");
    expect(html).toContain("<li>Prix");
  });

  it("shows the regeneration line in French while it runs", async () => {
    const html = await render("ReviewSummary", {
      ...common,
      meetingId: "m1",
      editable: true,
      sections: [],
      editingId: null,
      regeneration: null,
      draftRegeneration: {
        status: "running",
        attempts: 1,
        maxAttempts: 5,
        nextRunAt: null,
        lastErrorCode: null,
        sectionId: null,
      },
      isHit: () => false,
      sourceLink: noSource,
    });
    expect(html).toContain("Régénération : En cours.");
    expect(html).toContain("Vérifier à nouveau");
    expect(html).toContain("Le résumé n’a aucune section.");
  });

  it("move control: French, with the folder names as the owner wrote them", async () => {
    const html = await render("ReviewMoveFolder", {
      base: "/meetings/m1/review",
      csrf: "tok",
      moveTargets: [{ id: "f2", name: "Clients" }],
      moveErrors: [],
    });
    expect(html).toContain("Déplacer vers un dossier");
    expect(html).toContain("Déplacer cette note vers");
    expect(html).toContain(">Clients<");
  });
});
