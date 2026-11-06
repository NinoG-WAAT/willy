import { getViteConfig } from "astro/config";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as Translate from "../../../src/i18n/translate";

/**
 * The shared list components rendered through Astro's own compiler in French (strict mode: a
 * string without a French entry throws) and in English (the source text, unchanged).
 */

type Component = Parameters<AstroContainer["renderToString"]>[0];
type Props = Record<string, unknown>;

const NBSP = " ";
let server: ViteDevServer;
let i18n: typeof Translate;
let container: AstroContainer;
const components = new Map<string, Component>();

async function load(name: string): Promise<void> {
  const module = (await server.ssrLoadModule(`/src/components/${name}.astro`)) as {
    default: Component;
  };
  components.set(name, module.default);
}

async function render(name: string, props: Props, locale: "en" | "fr"): Promise<string> {
  i18n.setLocaleResolver(() => locale);
  const component = components.get(name);
  if (!component) throw new Error(`not loaded: ${name}`);
  return container.renderToString(component, { props });
}

beforeAll(async () => {
  const config = await getViteConfig({})({ command: "serve", mode: "test" });
  server = await createServer({ ...config, server: { middlewareMode: true }, logLevel: "silent" });
  i18n = (await server.ssrLoadModule("/src/i18n/translate.ts")) as typeof Translate;
  const catalog = (await server.ssrLoadModule("/src/i18n/fr/index.ts")) as {
    fr: Record<string, string>;
  };
  i18n.registerCatalog("fr", catalog.fr);
  i18n.configureI18n({ strict: true });
  container = await AstroContainer.create();
  for (const name of ["MeetingCard", "MeetingHeader", "Pager", "ErrorSummary", "TemplateForm"]) {
    await load(name);
  }
}, 60_000);

afterAll(async () => {
  await server.close();
});

const meeting = {
  id: "m1",
  title: "Point hebdo",
  status: "review",
  scheduledStartAt: "2026-11-04T09:00:00.000Z",
  scheduledEndAt: "2026-11-04T09:30:00.000Z",
  timezone: "Europe/Paris",
  calendarProvider: "google",
  consentConfirmedAt: null,
  attendeeCount: 3,
  folderName: null,
  noteStatus: "draft",
};

describe("MeetingCard", () => {
  it("is French in French: facts, attendees, calendar origin, action and screen-reader suffix", async () => {
    const html = await render("MeetingCard", { item: meeting }, "fr");
    expect(html).toContain("Point hebdo");
    expect(html).toContain("3 participants");
    expect(html).toContain("Depuis votre calendrier");
    expect(html).toContain(`Statut${NBSP}:`);
    expect(html).toContain("Brouillon");
    expect(html).toContain(`Consentement${NBSP}:`);
    expect(html).toContain("Votre confirmation du consentement est encore nécessaire");
    expect(html).toContain("Relire la note");
    expect(html).toContain("pour Point hebdo");
    expect(html).not.toContain("Review note");
  });

  it("is English in English, with the singular", async () => {
    const html = await render("MeetingCard", { item: { ...meeting, attendeeCount: 1 } }, "en");
    expect(html).toContain("1 attendee");
    expect(html).toContain("From your calendar");
    expect(html).toContain("Review note");
    expect(html).toContain("for Point hebdo");
  });
});

describe("MeetingHeader", () => {
  const props = {
    page: "review",
    meeting: { ...meeting, status: "review" },
    noteStatus: "draft",
    folder: null,
    template: { id: "t1", name: "Appel client" },
  };

  it("translates the status, the stepper, the chips and the action in French", async () => {
    const html = await render("MeetingHeader", props, "fr");
    expect(html).toContain("Brouillon");
    expect(html).toContain("Non publiée");
    expect(html).toContain(`Étape 4 sur 5${NBSP}: Brouillon`);
    expect(html).toContain("Étape en cours");
    expect(html).toContain(`Modèle${NBSP}: Appel client`);
    expect(html).toContain("Où se trouve cette note");
    expect(html).toContain("Publier dans un dossier");
  });

  it("keeps the English words in English", async () => {
    const html = await render("MeetingHeader", props, "en");
    expect(html).toContain("Step 4 of 5: Draft");
    expect(html).toContain("Not published");
    expect(html).toContain("Template: Appel client");
  });
});

describe("Pager", () => {
  const page = { page: 2, pageCount: 3, offset: 25, limit: 25, hasPrevious: true, hasNext: true };

  it("says the page numbers and the links in French", async () => {
    const html = await render("Pager", { page, previousHref: "/a", nextHref: "/b" }, "fr");
    expect(html).toContain("Page 2 sur 3");
    expect(html).toContain("Page précédente");
    expect(html).toContain("Page suivante");
    expect(html).toContain('aria-label="Pages de notes"');
  });

  it("says them in English in English", async () => {
    const html = await render("Pager", { page, previousHref: "/a", nextHref: "/b" }, "en");
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain("Previous page");
  });
});

describe("ErrorSummary", () => {
  it("introduces the list in French and shows the (already translated) messages as given", async () => {
    const errors = [{ field: "name", message: "Saisissez un nom de dossier." }];
    const html = await render("ErrorSummary", { errors }, "fr");
    expect(html).toContain(`Corrigez les points suivants avant de continuer${NBSP}:`);
    expect(html).toContain("Saisissez un nom de dossier.");
  });
});

describe("TemplateForm", () => {
  const props = {
    action: "/settings/templates/new",
    csrfToken: "token",
    name: "",
    isDefault: false,
    sections: [{ heading: "Bilan", prompt: "" }],
    errors: [{ field: "sections.0.heading", message: "Donnez un titre à cette section." }],
    submitLabel: "Créer le modèle",
    blankRows: 1,
  };

  it("translates labels, help, legend and the error summary in French, not the owner's words", async () => {
    const html = await render("TemplateForm", props, "fr");
    expect(html).toContain("Nom du modèle");
    expect(html).toContain("Section 1");
    expect(html).toContain("Section 2");
    expect(html).toContain("Titre");
    expect(html).toContain("Instruction (facultative)");
    expect(html).toContain("Utiliser comme mon modèle par défaut pour les nouvelles réunions");
    expect(html).toContain(`Corrigez les points suivants avant d’enregistrer${NBSP}:`);
    expect(html).toContain("Annuler");
    expect(html).toContain('value="Bilan"');
  });

  it("stays English in English", async () => {
    const html = await render("TemplateForm", { ...props, submitLabel: "Create template" }, "en");
    expect(html).toContain("Template name");
    expect(html).toContain("Prompt (optional)");
    expect(html).toContain("Fix the following before saving:");
  });
});
