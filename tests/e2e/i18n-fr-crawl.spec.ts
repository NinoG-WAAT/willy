import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  addOutlineItems,
  advanceDeletion,
  advanceProcessing,
  createCapturingMeeting,
  createDeletionInState,
  createReviewMeeting,
  expireSession,
  reviewFolderName,
} from "../support/e2e-db";
import { createFolderWithNotes } from "../support/folder-fixtures";
import {
  crawl,
  expectFrenchPage,
  signInAsFrenchOwner,
  type CrawlOptions,
} from "../support/french-crawl";
import { DEV_PASSWORD, addVocabularyTerms, createFreshOwner } from "../support/journey-db";
import { createFolder, createNotes } from "../support/notes-fixtures";

/**
 * The French crawl (#128, package 7 of #113): every screen and state in French, with strict mode
 * on (a `t()` without a French entry turns its page into a 500, which every visit here rejects),
 * no horizontal scroll at the window's width (the phone project is 390px) and no English left in
 * the interface. The scan looks at text nodes, labels, titles and alt texts with every disclosure
 * opened; text the owner wrote is listed per page and left out. Owners are brand new and choose
 * Français in the real Settings form on the English server, so the data fixtures (which live in
 * that server's database) can be used; signed-out pages are French on the second server only.
 */

// A test visits many pages, each scanned after a full render.
test.describe.configure({ timeout: 120_000 });

/** What the review fixture's owner "wrote" (seed text is English on purpose: it must stay as is). */
const REVIEW_OWNER_TEXT: (string | RegExp)[] = [
  "Let's review the roadmap.",
  "We ship in November.",
  "I will send the deck.",
  "We reviewed the roadmap.",
  "Pricing is pending.",
  // A search hit highlights one word, so the rest of the sentence is a text node of its own.
  "is pending.",
  "Ship in November",
  "Send the deck",
  "Hire a product designer in the first quarter",
  "Move the launch review to Fridays",
  "Book the venue for the offsite",
  "Share the pricing sheet with the board",
  "Renew the office licence",
  /Folder for e2e-[a-z0-9]+/g,
  /Meeting e2e-[a-z0-9]+/g,
  /Line \d+: we talked through the plan for the quarter\./g,
  /\b(Summary|Risks)\b/g,
  /Speaker \d/g,
];

const review = (extra: CrawlOptions = {}): CrawlOptions => ({
  ...extra,
  ownerText: [...REVIEW_OWNER_TEXT, ...(extra.ownerText ?? [])],
});

/** The calendar file's own words (titles, descriptions, places) are the calendar's, not ours. */
function icsOwnerText(): (string | RegExp)[] {
  const file = readFileSync("tests/fixtures/ics/outlook-week.ics", "utf8");
  const unescape = (value: string): string => value.replace(/\\([,;])/g, "$1");
  const words = [...file.matchAll(/^(?:SUMMARY|LOCATION)[^:\n]*:(.*)$/gm)].map((m) =>
    unescape((m[1] ?? "").trim()),
  );
  return [...words.filter((w) => w !== ""), /Weekly product sync[^]*/g, /Weekly 1:1\.[^]*/g];
}

const day = (offsetDays: number, hour = 9): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const REVIEW_NOTICES = [
  "moved",
  "move_unchanged",
  "section_saved",
  "decision_saved",
  "decision_added",
  "decision_removed",
  "action_saved",
  "action_added",
  "action_removed",
  "action_done",
  "action_reopened",
  "speaker_renamed",
  "speakers_merged",
  "speaker_assigned",
  "published",
  "reopened",
  "retry_queued",
  "draft_regeneration_queued",
  "regeneration_queued",
];

test.describe("lists and folders", () => {
  test("Inbox: empty, every status, every notice and problem", async ({ page }) => {
    const owner = await signInAsFrenchOwner(page);
    await crawl(page, "/");

    createNotes(owner.id, [
      { title: "Point hebdomadaire", status: "scheduled", startsAt: day(1) },
      { title: "Appel du jour", status: "scheduled", startsAt: day(0, 23) },
      { title: "Réunion en direct", status: "capturing", startsAt: day(0, 1) },
      { title: "Réunion en pause", status: "paused", startsAt: day(0, 2) },
      { title: "Traitement en cours", status: "processing", startsAt: day(-1) },
      { title: "Traitement échoué", status: "failed", startsAt: day(-2) },
      { title: "Brouillon à relire", status: "review", startsAt: day(-3) },
      { title: "Note publiée", status: "published", startsAt: day(-4) },
      { title: "Note archivée", status: "archived", startsAt: day(-5) },
    ]);
    await crawl(page, "/");
    for (const q of [
      "notice=created",
      "notice=imported&new=3&existing=1",
      "notice=imported&new=1&existing=0",
      "notice=imported&new=0&existing=0",
      "notice=imported",
      "notice=ics_imported&new=2&existing=2",
      "notice=ics_imported",
      "problem=calendar_unavailable",
      "problem=calendar_busy",
      "problem=calendar_not_connected",
    ]) {
      await crawl(page, `/?${q}`);
    }
  });

  test("Inbox calendar import button, with a working fake calendar", async ({ page }) => {
    await signInAsFrenchOwner(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Importer depuis le calendrier" }).click();
    await expect(page).toHaveURL(/\/\?notice=imported/);
    // The fake calendar's event titles are the calendar's own words.
    await expectFrenchPage(page, "after the calendar import", {
      ownerText: [/Customer call with Grace \(demo\)/g, /Investor update \(demo\)/g],
    });
  });

  test("All notes: empty, filters, no match, every filter state", async ({ page }) => {
    const owner = await signInAsFrenchOwner(page);
    await crawl(page, "/notes");
    const { folderId } = createFolderWithNotes(owner.id, "Clients", [
      { title: "Bilan client", startsAt: day(-1) },
    ]);
    createNotes(owner.id, [
      { title: "Brouillon à relire", status: "review", startsAt: day(-3) },
      { title: "Note archivée", status: "archived", startsAt: day(-5) },
    ]);
    for (const q of [
      "",
      "?status=draft",
      "?status=published",
      "?status=archived",
      `?folder=${folderId}`,
      `?status=published&folder=${folderId}`,
      "?status=archived&folder=does-not-exist",
      "?status=bogus",
      "?page=2",
      "?page=999",
    ]) {
      await crawl(page, `/notes${q}`);
    }
  });

  test("Folders: list, create, duplicate, rename, open, delete (empty and not empty)", async ({
    page,
  }) => {
    const owner = await signInAsFrenchOwner(page);
    await crawl(page, "/folders");
    const { folderId } = createFolderWithNotes(owner.id, "Comité", [
      { title: "Réunion du comité", startsAt: day(-2) },
      { title: "Archive du comité", status: "archived", startsAt: day(-3) },
    ]);
    const emptyId = createFolder(owner.id, "Vide");
    await crawl(page, "/folders");
    for (const q of ["folder_created", "folder_renamed", "folder_deleted"]) {
      await crawl(page, `/folders?notice=${q}`);
    }
    await crawl(page, `/folders/${folderId}`);
    await crawl(page, `/folders/${emptyId}`);
    await crawl(page, `/folders/${folderId}/delete`);
    await crawl(page, `/folders/${emptyId}/delete`);
    await crawl(page, "/folders/does-not-exist", { status: 404 });
    await crawl(page, "/folders/does-not-exist/delete", { status: 404 });

    // The real forms: a duplicate name and a blank name.
    await page.goto("/folders");
    await page.getByLabel("Nom du dossier", { exact: true }).fill("comité");
    await page.getByRole("button", { name: "Créer le dossier" }).click();
    await expect(page.locator(".field-error")).toBeVisible();
    await expectFrenchPage(page, "duplicate folder name");
    await page.evaluate(() => {
      document.querySelector("form")?.setAttribute("novalidate", "");
    });
    await page.getByLabel("Nom du dossier", { exact: true }).fill("   ");
    await page.getByRole("button", { name: "Créer le dossier" }).click();
    await expect(page.locator(".field-error")).toBeVisible();
    await expectFrenchPage(page, "blank folder name");
  });

  test("Templates: list, new, rejected, saved, default, edit, delete", async ({ page }) => {
    await signInAsFrenchOwner(page);
    await crawl(page, "/settings/templates");
    await crawl(page, "/settings/templates/new");
    await page.getByLabel("Nom du modèle").fill("Appel client");
    await page.locator("#section-0-heading").fill("Bilan");
    await page.locator("#section-1-heading").fill("bilan");
    await page.getByRole("button", { name: "Créer le modèle" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectFrenchPage(page, "rejected template");

    await page.locator("#section-1-heading").fill("Suites");
    await page.getByRole("button", { name: "Créer le modèle" }).click();
    await expect(page).toHaveURL(/notice=template_created/);
    await expectFrenchPage(page, "template created");
    await page.getByRole("button", { name: "Définir par défaut le modèle Appel client" }).click();
    await expectFrenchPage(page, "template made default");
    await page.getByRole("link", { name: "Modifier le modèle Appel client" }).click();
    await expectFrenchPage(page, "template edit");
    const editUrl = page.url();
    await page.goto(editUrl.replace(/\/$/, "") + "?notice=template_saved");
    await expectFrenchPage(page, "template saved notice");
    await page.goto("/settings/templates");
    await page.getByRole("link", { name: "Supprimer le modèle Appel client" }).click();
    await expectFrenchPage(page, "template delete");
    await page.getByRole("button", { name: "Supprimer le modèle" }).click();
    await expect(page).toHaveURL(/notice=template_deleted/);
    await expectFrenchPage(page, "template deleted");
    await crawl(page, "/settings/templates/does-not-exist", { status: 404 });
    await crawl(page, "/settings/templates/does-not-exist/delete", { status: 404 });
  });
});

test.describe("notes: new, live, import", () => {
  test("New note: empty and every rejection", async ({ page }) => {
    await signInAsFrenchOwner(page);
    await crawl(page, "/meetings/new");
    await page.evaluate(() => {
      document.querySelector("form.form")?.setAttribute("novalidate", "");
    });
    await page.getByLabel("Date", { exact: true }).fill("");
    await page.getByLabel("Heure de début").fill("");
    await page.getByLabel("Durée (minutes)").fill("2");
    await page.getByLabel("Participants (facultatif)").fill("Ada <pas-un-mail>");
    await page.getByRole("button", { name: "Créer la note" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectFrenchPage(page, "new note rejected", { ownerText: ["Ada <pas-un-mail>"] });
  });

  test("Live note: scheduled, capturing, paused, failed, processing, review redirect", async ({
    page,
  }) => {
    const owner = await signInAsFrenchOwner(page);
    for (const status of ["scheduled", "capturing", "paused", "failed", "processing"] as const) {
      const id = createCapturingMeeting(owner.id, status, "Réunion de test");
      await crawl(page, `/meetings/${id}`, { ownerText: ["Réunion de test"] });
    }
    const id = createCapturingMeeting(owner.id, "capturing", "Réunion de test");
    for (const q of ["notes_saved", "retry_queued", "created"]) {
      await crawl(page, `/meetings/${id}?notice=${q}`);
    }
    await crawl(page, "/meetings/does-not-exist", { status: 404 });
  });

  test("Live note: the consent refusal and the failed-capture retry as the server words them", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const owner = await signInAsFrenchOwner(page);
    const id = createCapturingMeeting(owner.id, "scheduled", "Sans consentement");
    await page.goto(`/meetings/${id}`);
    await page.getByRole("button", { name: "Démarrer l’enregistrement" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectFrenchPage(page, "capture without consent", { ownerText: ["Sans consentement"] });
    await context.close();
  });

  test("ICS import: form, refusals, preview, confirmation, empty selection", async ({ page }) => {
    await signInAsFrenchOwner(page);
    await crawl(page, "/meetings/import/ics");
    await page.getByRole("button", { name: "Prévisualiser les événements" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectFrenchPage(page, "ics refusal: nothing given");
    await page.getByLabel("Ou collez le texte du calendrier").fill("<html>bonjour</html>");
    await page.getByRole("button", { name: "Prévisualiser les événements" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectFrenchPage(page, "ics refusal: not a calendar", {
      ownerText: ["<html>bonjour</html>"],
    });

    await page.goto("/meetings/import/ics");
    await page
      .getByLabel("Fichier de calendrier (.ics, 1 Mo maximum)")
      .setInputFiles("tests/fixtures/ics/outlook-week.ics");
    await page.getByRole("button", { name: "Prévisualiser les événements" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Aperçu" })).toBeVisible();
    await expectFrenchPage(page, "ics preview", { ownerText: icsOwnerText() });
    await page.getByRole("button", { name: "Importer les événements sélectionnés" }).click();
    await expect(page).toHaveURL(/\/\?notice=ics_imported/);
    await expectFrenchPage(page, "after the ics import", { ownerText: icsOwnerText() });
  });
});

test.describe("review", () => {
  test("draft: summary, decisions, actions, editing forms, notices, transcript, speakers", async ({
    page,
  }) => {
    const owner = await signInAsFrenchOwner(page);
    const id = await createReviewMeeting(owner.id, 25);
    addOutlineItems(id);
    const base = `/meetings/${id}/review`;
    await crawl(page, base, review());
    for (const target of [
      `edit=${id}-sec-0#section-${id}-sec-0`,
      `edit=${id}-dec-1`,
      `edit=${id}-act-1`,
      `edit=${id}-act-3`,
      "src=0-10001",
      `hit=note_section:${id}-sec-1`,
      "edit=does-not-exist",
    ]) {
      await crawl(page, `${base}?${target}`, review());
    }
    for (const notice of REVIEW_NOTICES) {
      await crawl(page, `${base}?notice=${notice}`, review());
    }
  });

  test("draft: every rejected form explains itself in French", async ({ page }) => {
    const owner = await signInAsFrenchOwner(page);
    const id = await createReviewMeeting(owner.id);
    addOutlineItems(id);
    const base = `/meetings/${id}/review`;

    await page.goto(`${base}?edit=${id}-dec-1#decision-${id}-dec-1`);
    await page.locator(`#decision-text-${id}-dec-1`).fill("   ");
    await page.getByRole("button", { name: /^Enregistrer la décision/ }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectFrenchPage(page, "rejected decision", review());

    await page.goto(base);
    await page.getByText("Renommer ou fusionner des intervenants", { exact: true }).click();
    await page.getByRole("button", { name: "Renommer l’intervenant" }).click();
    await expect(page.locator(".field-error").first()).toBeVisible();
    await expectFrenchPage(page, "rejected rename", review());

    await page.goto(base);
    await page.locator(".publish-details > summary").click();
    await page.getByRole("button", { name: "Publier dans un dossier" }).last().click();
    await expect(page.locator(".field-error").first()).toBeVisible();
    await expectFrenchPage(page, "rejected publish", review());
  });

  test("draft: assign a speaker and regenerate", async ({ page }) => {
    const owner = await signInAsFrenchOwner(page);
    const id = await createReviewMeeting(owner.id);
    await page.goto(`/meetings/${id}/review`);
    await page.locator("#transcript-panel > summary").click();
    await page
      .getByRole("checkbox", { name: /^Sélectionner la ligne/ })
      .last()
      .check();
    await page.getByLabel("Attribuer les lignes cochées à").fill("Grace Hopper");
    await page.getByRole("button", { name: "Attribuer" }).click();
    await expect(page).toHaveURL(/notice=speaker_assigned/);
    await expectFrenchPage(page, "after assigning lines", review({ ownerText: [/Grace Hopper/g] }));

    const disclosure = page.locator("details#regenerate-draft");
    await disclosure.locator("summary").click();
    await disclosure.getByRole("checkbox").check();
    await disclosure.getByRole("button", { name: "Régénérer tout le brouillon" }).click();
    await expect(page).toHaveURL(/notice=draft_regeneration_queued/);
    await expectFrenchPage(page, "after regenerating the draft", review());

    await page.locator("details.outline-menu > summary").first().click();
    await page
      .getByRole("button", { name: /^Régénérer cette section/ })
      .first()
      .click();
    await expect(page).toHaveURL(/notice=regeneration_queued/);
    await expectFrenchPage(page, "after regenerating a section", review());
  });

  test("published: read-only, reopened, and moved", async ({ page }) => {
    const owner = await signInAsFrenchOwner(page);
    const id = await createReviewMeeting(owner.id);
    await page.goto(`/meetings/${id}/review`);
    await page.locator(".publish-details > summary").click();
    await page.getByLabel("Dossier privé").selectOption({ label: reviewFolderName(id) });
    await page.getByLabel("J’ai relu cette note et je souhaite la publier.").check();
    await page.getByRole("button", { name: "Publier dans un dossier" }).last().click();
    await expect(page).toHaveURL(/notice=published/);
    await expectFrenchPage(page, "published", review());
    await crawl(page, `/meetings/${id}/review`, review());
    await page.getByRole("button", { name: "Rouvrir pour modifier" }).click();
    await expect(page).toHaveURL(/notice=reopened/);
    await expectFrenchPage(page, "reopened", review());
  });

  test("processing and failure: every job state, with the retry button", async ({ page }) => {
    const owner = await signInAsFrenchOwner(page);
    const id = await createReviewMeeting(owner.id);
    const base = `/meetings/${id}/review`;
    const states: Parameters<typeof advanceProcessing>[1][] = [
      { meeting: "processing", transcription: "pending" },
      { meeting: "processing", transcription: "running", summary: "pending" },
      { meeting: "processing", transcription: "retrying", errorCode: "stt_unavailable" },
      { meeting: "processing", transcription: "succeeded", summary: "running" },
      {
        meeting: "review",
        transcription: "succeeded",
        summary: "failed",
        errorCode: "llm_timeout",
      },
      {
        meeting: "review",
        transcription: "succeeded",
        summary: "retrying",
        errorCode: "llm_rate_limited",
      },
      { meeting: "failed", transcription: "failed", errorCode: "stt_rejected" },
      { meeting: "review", transcription: "succeeded", summary: "succeeded" },
    ];
    for (const to of states) {
      advanceProcessing(id, to);
      const response = await page.goto(base);
      expect(response?.status(), JSON.stringify(to)).toBeLessThan(500);
      await expectFrenchPage(page, `${base} ${JSON.stringify(to)}`, review());
      const live = await page.goto(`/meetings/${id}`);
      expect(live?.status(), `live ${JSON.stringify(to)}`).toBeLessThan(500);
      await expectFrenchPage(page, `/meetings/${id} ${JSON.stringify(to)}`, review());
    }
  });
});

test.describe("search and settings", () => {
  test("Search: empty, blank, no hit, hits, archived and folder filters", async ({ page }) => {
    const owner = await signInAsFrenchOwner(page);
    const id = await createReviewMeeting(owner.id);
    const folder = createFolder(owner.id, "Clients");
    await crawl(page, "/search", review());
    // A blank or oversized query is refused with 422 and a sentence; the rest are answers.
    const searches: [string, number][] = [
      ["?q=%20%20", 422],
      ["?q=xyzzynotthere", 200],
      ["?q=pricing", 200],
      ["?q=pricing&archived=1", 200],
      [`?q=pricing&folder=${folder}`, 200],
      ["?q=" + "a".repeat(400), 422],
      ["?q=%22%27%3Cb%3E", 200],
    ];
    for (const [q, status] of searches) {
      await crawl(
        page,
        `/search${q}`,
        review({ status, ownerText: [/xyzzynotthere/g, /a{20,}/g, /"'<b>/g] }),
      );
    }
    expect(id).toBeTruthy();
  });

  test("Settings hub, every notice, deletion in every state, retention form", async ({ page }) => {
    const owner = await signInAsFrenchOwner(page);
    await crawl(page, "/settings");
    const reviewId = await createReviewMeeting(owner.id);
    const pending = createDeletionInState(owner.id, "pending");
    createDeletionInState(owner.id, "retrying");
    const failed = createDeletionInState(owner.id, "failed");
    await crawl(page, "/settings", review());
    for (const state of ["running", "succeeded"] as const) {
      advanceDeletion(pending, state);
      await crawl(page, "/settings", review());
    }
    expect(failed).toBeTruthy();
    for (const q of [
      "language_saved",
      "retention_saved",
      "deletion_requested",
      "deletion_repeated",
      "retry_queued",
      "vocabulary_removed",
      "bogus",
    ]) {
      await crawl(page, `/settings?notice=${q}`, review());
    }

    // Retention: the rejected form and the saved one.
    await page.goto("/settings");
    await page.getByLabel("Notes et transcriptions").selectOption({
      label: "Supprimer définitivement les réunions 90 jours après leur début prévu",
    });
    await page.getByRole("button", { name: "Enregistrer la conservation" }).click();
    await expect(page.locator(".field-error")).toBeVisible();
    await expectFrenchPage(page, "rejected retention", review());
    await page.getByLabel(/^Je comprends que les réunions plus anciennes/).check();
    await page.getByRole("button", { name: "Enregistrer la conservation" }).click();
    await expectFrenchPage(page, "saved retention", review());

    // Retrying a stopped deletion.
    await page
      .getByRole("button", { name: /^Réessayer la suppression/ })
      .first()
      .click();
    await expectFrenchPage(page, "deletion retried", review());

    // Permanent deletion of a meeting: the page, the wrong word, the started deletion.
    await crawl(page, `/meetings/${reviewId}/delete`, review());
    await page.getByRole("button", { name: "Supprimer définitivement" }).click();
    await expect(page.locator(".field-error")).toBeVisible();
    await expectFrenchPage(page, "wrong deletion word", review());
    await crawl(page, "/meetings/does-not-exist/delete", review({ status: 404 }));
    for (const language of ["klingon", ""]) {
      const origin = new URL(page.url()).origin;
      const token = await page.locator("input[name=csrf_token]").first().getAttribute("value");
      const res = await page.request.post("/settings/language", {
        headers: { origin },
        form: { csrf_token: token ?? "", language },
        maxRedirects: 0,
      });
      expect([303, 400, 422], `language "${language}"`).toContain(res.status());
    }
  });

  test("Vocabulary: empty, errors, words, excluded words, notice", async ({ page }) => {
    const owner = await signInAsFrenchOwner(page);
    await crawl(page, "/settings/vocabulary");
    await page.getByLabel("Mots à ajouter").fill("-nope");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(page.locator(".field-error")).toBeVisible();
    await expectFrenchPage(page, "vocabulary rejected", { ownerText: ["-nope"] });
    await page.getByLabel("Mots à ajouter").fill("Zorglub, Node.js");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expectFrenchPage(page, "vocabulary added", { ownerText: ["Zorglub", "Node.js"] });
    await page.getByRole("button", { name: "Retirer Zorglub" }).click();
    await expectFrenchPage(page, "vocabulary removed", { ownerText: ["Node.js"] });
    addVocabularyTerms(
      owner.id,
      Array.from({ length: 30 }, (_, i) => `Terme${String(i)}${"x".repeat(40)}`),
    );
    await crawl(page, "/settings/vocabulary", { ownerText: [/Terme\d+x+/g, "Node.js"] });
    await crawl(page, "/settings/vocabulary?notice=vocabulary_removed", {
      ownerText: [/Terme\d+x+/g, "Node.js"],
    });
  });

  test("Diagnostics answers JSON of codes and counts, never a sentence in either language", async ({
    page,
  }) => {
    await signInAsFrenchOwner(page);
    const response = await page.request.get("/diagnostics");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(Object.keys(await response.json()).length).toBeGreaterThan(0);
  });
});

test.describe("error pages", () => {
  test("404 for an unknown route, an unknown id and another owner's id", async ({ page }) => {
    const owner = await signInAsFrenchOwner(page);
    await crawl(page, "/no-such-page", { status: 404 });
    await crawl(page, "/meetings/does-not-exist/review", { status: 404 });
    await crawl(page, "/meetings/meeting-a-overdue/review", { status: 404 });
    await crawl(page, "/folders/folder-a-board", { status: 404 });
    expect(owner.id).toBeTruthy();
  });

  test("403 for a request without a CSRF token, 429 when the allowance is used", async ({
    page,
  }) => {
    await signInAsFrenchOwner(page);
    const origin = new URL(page.url()).origin;
    const refused = await page.request.post("/settings/language", {
      headers: { origin },
      form: { language: "en" },
      maxRedirects: 0,
    });
    expect(refused.status()).toBe(403);
    await page.setContent(await refused.text());
    await expectFrenchPage(page, "403");

    const token = await page.request
      .get("/settings")
      .then((r) => r.text())
      .then((html) => /name="csrf_token" value="([^"]+)"/.exec(html)?.[1] ?? "");
    let limited: string | null = null;
    for (let i = 0; i < 60 && limited === null; i++) {
      const res = await page.request.post("/meetings/import/ics", {
        headers: { origin },
        multipart: { csrf_token: token, ics_text: "not a calendar", floating_zone: "UTC" },
        maxRedirects: 0,
      });
      if (res.status() === 429) limited = await res.text();
    }
    expect(limited, "429 after the allowance is used").not.toBeNull();
    await page.setContent(limited ?? "");
    await expectFrenchPage(page, "429");
  });
});

test.describe("signed out, on the French server", () => {
  const frenchBase = process.env["E2E_FR_BASE_URL"];
  test.use({ ...(frenchBase ? { baseURL: frenchBase } : {}) });

  test("sign-in, its errors, signed-out, session-expired and the redirect", async ({
    page,
    context,
  }) => {
    await crawl(page, "/sign-in");
    await crawl(page, "/sign-in?next=%2Fsearch%3Fq%3Dbudget");
    await crawl(page, "/signed-out");
    await crawl(page, "/session-expired");
    await crawl(page, "/session-expired?next=%2Fsearch%3Fq%3Dbudget");
    // Signed out, an unknown address is a protected one: the sign-in page, never a 404 that
    // would tell a stranger which addresses exist.
    await page.goto("/no-such-page");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fno-such-page$/);
    await expectFrenchPage(page, "sign-in after an unknown address");

    await page.goto("/sign-in");
    await page.getByLabel("Adresse e-mail").fill("ada@example.test");
    await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectFrenchPage(page, "wrong password", { ownerText: ["ada@example.test"] });

    const email = `ratelimit-${String(Date.now())}@example.test`;
    for (let i = 0; i < 6; i++) {
      await page.goto("/sign-in");
      await page.getByLabel("Adresse e-mail").fill(email);
      await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
      await page.getByRole("button", { name: "Se connecter" }).click();
    }
    await expect(page.getByRole("alert")).toBeVisible();
    await expectFrenchPage(page, "sign-in rate limited", { ownerText: [email] });

    // A session that idled out: the redirect, the page, and the notice on the sign-in form.
    const owner = createFreshOwner("fr");
    await page.goto("/sign-in");
    await page.getByLabel("Adresse e-mail").fill(owner.email);
    await page.getByLabel("Mot de passe").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL("/");
    const cookie = (await context.cookies()).find((c) => c.name === "__Host-willy_session");
    expireSession(cookie?.value ?? "", "fr");
    await page.goto("/");
    await expect(page).toHaveURL(/\/session-expired/);
    await expectFrenchPage(page, "session expired redirect");
  });

  test("a French-default owner crawls the shell on the French server", async ({ page }) => {
    const owner = createFreshOwner("fr");
    await page.goto("/sign-in");
    await page.getByLabel("Adresse e-mail").fill(owner.email);
    await page.getByLabel("Mot de passe").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL("/");
    for (const path of [
      "/",
      "/notes",
      "/folders",
      "/search",
      "/meetings/new",
      "/meetings/import/ics",
      "/settings",
      "/settings/templates",
      "/settings/templates/new",
      "/settings/vocabulary",
    ]) {
      await crawl(page, path);
    }
  });
});
