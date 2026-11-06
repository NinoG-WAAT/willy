import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createDeletionInState, createReviewMeeting } from "../support/e2e-db";
import {
  DEV_PASSWORD,
  addVocabularyTerms,
  createFreshOwner,
  type FreshOwner,
} from "../support/journey-db";

/**
 * Search, the Settings screens, the permanent deletion page, the error pages and the Markdown
 * export in French (#121). Each owner is brand new and chooses Français in the real Settings form
 * (nothing is written to the database for that), on the English server; both servers run in
 * strict mode, so a string without a French entry would turn a page into an error page.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const NBSP = " ";
const htmlLang = (page: Page) => page.locator("html").getAttribute("lang");

async function signInInFrench(page: Page): Promise<FreshOwner> {
  const owner = createFreshOwner();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings");
  await page.getByLabel("Language / Langue").selectOption({ label: "Français" });
  await page.getByRole("button", { name: "Save language" }).click();
  await expect(page.getByText("Langue enregistrée.")).toBeVisible();
  return owner;
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    results.violations.map((v) => ({ rule: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}

test.describe("settings hub in French", () => {
  test("every section is French, the retention form reports and saves in French", async ({
    page,
  }) => {
    await signInInFrench(page);
    expect(await htmlLang(page)).toBe("fr");
    await expect(page).toHaveTitle("Paramètres - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Paramètres" })).toBeVisible();
    for (const heading of [
      "Langue",
      "État des fournisseurs",
      "Conservation",
      "Modèles et dossiers",
      "Vocabulaire",
      "Exportation",
      "Suppression définitive",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }

    // Provider status: the labels, the state words and the modes are French; names are not.
    await expect(
      page.getByRole("heading", { level: 3, name: "Reconnaissance vocale" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Résumés (LLM)" })).toBeVisible();
    await expect(page.getByText("Mode simulé").first()).toBeVisible();

    // The default retention line, in one French sentence.
    await expect(
      page.getByText(
        `Actuellement${NBSP}: supprimer juste après une transcription réussie (par défaut). Conserver les notes et les transcriptions jusqu’à ce que vous les supprimiez (par défaut).`,
      ),
    ).toBeVisible();
    await expect(page.getByText("Aucune suppression pour le moment.")).toBeVisible();
    await expect(page.getByText("Vous n’avez aucune réunion à supprimer.")).toBeVisible();

    // A mistake is reported in French, next to the field.
    await page.getByLabel("Notes et transcriptions").selectOption({
      label: "Supprimer définitivement les réunions 90 jours après leur début prévu",
    });
    await page.getByRole("button", { name: "Enregistrer la conservation" }).click();
    await expect(page.locator(".field-error")).toHaveText(
      "Cochez la case pour confirmer que les réunions plus anciennes seront supprimées définitivement.",
    );
    expect(await htmlLang(page)).toBe("fr");

    await page.getByLabel(/^Je comprends que les réunions plus anciennes/).check();
    await page.getByRole("button", { name: "Enregistrer la conservation" }).click();
    await expect(page.getByText("Paramètres de conservation enregistrés.")).toBeVisible();
    await expect(
      page.getByText("Supprimer définitivement les réunions 90 jours après leur début prévu."),
    ).toBeVisible();
  });

  test("fits a small screen and has no accessibility violations", async ({ page }) => {
    const owner = await signInInFrench(page);
    createDeletionInState(owner.id, "failed");
    await page.goto("/settings");
    await expectNoHorizontalScroll(page);
    await expectNoAxeViolations(page);
  });

  test("a stopped deletion is described and can be retried, in French", async ({ page }) => {
    const owner = await signInInFrench(page);
    createDeletionInState(owner.id, "failed");
    await page.goto("/settings");
    const row = page.locator("[data-deletion-id]");
    await expect(row.locator('[data-field="label"]')).toHaveText("Échec");
    await expect(row.locator('[data-field="detail"]')).toContainText(
      "La suppression s’est arrêtée après 5 tentatives (storage_unavailable).",
    );
    await expect(row).toContainText("Référence");
    await expect(row.getByRole("button", { name: /^Réessayer la suppression/ })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await row.getByRole("button", { name: /^Réessayer la suppression/ }).click();
    await expect(page.getByText("Suppression remise en file d’attente.")).toBeVisible();
    await expect(page.locator("[data-deletion-id] [data-field=label]")).toHaveText("En attente");
  });
});

test.describe("vocabulary in French", () => {
  test("adds, explains and removes words in French", async ({ page }) => {
    const owner = await signInInFrench(page);
    await page.goto("/settings/vocabulary");
    await expect(page).toHaveTitle("Vocabulaire - Willycrumbs");
    await expect(page.getByRole("link", { name: "Paramètres" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Fil d’Ariane" })).toBeVisible();
    await expect(
      page.getByText(
        "Aucun mot pour le moment. Ajoutez les noms qu’une transcription a tendance à mal écrire, comme un produit ou un client.",
      ),
    ).toBeVisible();

    await page.getByLabel("Mots à ajouter").fill("-nope");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(page.locator(".field-error")).toHaveText(
      `«${NBSP}-nope${NBSP}» ne peut pas commencer par un tiret.`,
    );

    await page.getByLabel("Mots à ajouter").fill("Zorglub, Node.js");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(
      page.getByText("Mots ajoutés. Ils seront utilisés pour la prochaine transcription."),
    ).toBeVisible();
    await expect(
      page.getByText("2 mots sur 2 sont utilisés par le moteur de reconnaissance vocale."),
    ).toBeVisible();
    await expect(
      page.getByText("Non corrigé automatiquement dans les transcriptions").first(),
    ).toBeVisible();
    await expect(
      page.getByText(
        /^Un mot marqué «\u00a0Non corrigé automatiquement dans les transcriptions\u00a0» \(il contient un point/,
      ),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Retirer Zorglub" }).click();
    await expect(page.getByText("Mot retiré.")).toBeVisible();
    await expect(
      page.getByText("1 mot sur 1 est utilisé par le moteur de reconnaissance vocale."),
    ).toBeVisible();
    expect(owner.id).toContain("owner-e2e-");
  });

  test("words that do not fit are marked in words", async ({ page }) => {
    const owner = await signInInFrench(page);
    addVocabularyTerms(
      owner.id,
      Array.from({ length: 30 }, (_, i) => `Terme${String(i)}${"x".repeat(40)}`),
    );
    await page.goto("/settings/vocabulary");
    await expect(page.getByRole("heading", { level: 3, name: "Exclus" })).toBeVisible();
    await expect(page.getByText("Non transmis").first()).toBeVisible();
    await expect(page.getByText(/ne tiennent pas et sont exclus\.$/)).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("search and export in French", () => {
  test("the screen, a miss, a mistake, a hit and the Markdown export", async ({ page }) => {
    const owner = await signInInFrench(page);
    const meetingId = await createReviewMeeting(owner.id);

    await page.goto("/search");
    await expect(page).toHaveTitle("Rechercher - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Rechercher" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Retrouvez ce que vous avez écrit ou décidé" }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: "Tous les dossiers" })).toBeAttached();
    await expectNoHorizontalScroll(page);

    await page.goto("/search?q=%20%20");
    await expect(page.locator(".field-error")).toHaveText(
      "Saisissez au moins un mot à rechercher.",
    );

    await page.goto("/search?q=xyzzynotthere");
    await expect(
      page.getByText(
        `Aucun résultat pour «${NBSP}xyzzynotthere${NBSP}». Vérifiez l’orthographe, essayez avec moins de mots ou incluez les réunions archivées.`,
      ),
    ).toBeVisible();

    await page.goto("/search?q=pricing");
    await expect(page).toHaveTitle("Recherche : pricing - Willycrumbs");
    await expect(page.getByRole("status").filter({ hasText: "résultat" })).toHaveText(
      `1 résultat pour «${NBSP}pricing${NBSP}».`,
    );
    const hit = page.getByRole("listitem").filter({ hasText: "Pricing is pending" });
    await expect(hit.locator(".row-meta")).toContainText(`Section du résumé${NBSP}: Risks`);
    await expect(hit.getByRole("link", { name: /^Ouvrir/ })).toBeVisible();
    await expect(hit.getByRole("link", { name: /^Exporter en Markdown/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoAxeViolations(page);

    const response = await page.request.get(`/meetings/${meetingId}/export.md`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("text/markdown; charset=utf-8");
    // The filename stays ASCII and English-neutral.
    expect(response.headers()["content-disposition"]).toMatch(
      /^attachment; filename="[a-z0-9-]+\.md"$/,
    );
    const markdown = await response.text();
    expect(markdown).toContain(`- **Quand${NBSP}:** `);
    expect(markdown).toContain(`- **Statut${NBSP}:** Brouillon de résumé, pas encore publié`);
    expect(markdown).toContain(`- **Participants${NBSP}:** Ada Lovelace, Grace Hopper`);
    expect(markdown).toContain("## Résumé");
    expect(markdown).toContain("## Décisions\n\n- Ship in November");
    expect(markdown).toMatch(
      /## Actions\n\n- \[ \] Send the deck \(responsable\u00a0: Ada Lovelace, échéance\u00a0: 30\/10\/2026\)/,
    );
    // The owner's own words are untouched.
    expect(markdown).toContain("Pricing is pending.");
  });

  test("works without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await signInInFrench(page);
    await page.goto("/search");
    await page.getByLabel("Rechercher dans vos notes").fill("xyzzynotthere");
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    await expect(page.getByText(/^Aucun résultat pour/)).toBeVisible();
    await context.close();
  });
});

test.describe("permanent deletion in French", () => {
  test("explains the scope, refuses a wrong word in French, then starts the deletion", async ({
    page,
  }) => {
    const owner = await signInInFrench(page);
    const meetingId = await createReviewMeeting(owner.id);

    await page.goto("/settings");
    await expect(page.getByRole("link", { name: /^Exporter en Markdown/ }).first()).toBeVisible();
    await page
      .getByRole("link", { name: /^Supprimer définitivement/ })
      .first()
      .click();

    await expect(page).toHaveURL(new RegExp(`/meetings/${meetingId}/delete$`));
    await expect(page).toHaveTitle("Supprimer définitivement la réunion - Willycrumbs");
    await expect(
      page.getByRole("heading", { level: 1, name: "Supprimer définitivement la réunion" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Ce qui sera détruit" }),
    ).toBeVisible();
    await expect(page.getByText("Cette action est irréversible.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Supprimer définitivement" }).click();
    await expect(page.locator(".field-error")).toHaveText(
      "Saisissez DELETE en majuscules pour confirmer. Rien n’a été supprimé.",
    );

    await page.getByLabel("Saisissez DELETE pour confirmer").fill("DELETE");
    await page.getByRole("button", { name: "Supprimer définitivement" }).click();
    await expect(page).toHaveURL(/\/settings\?notice=deletion_requested/);
    await expect(
      page.getByText(
        "Suppression lancée. La réunion est déjà masquée partout. Sa progression est affichée ci-dessous.",
      ),
    ).toBeVisible();
    await expect(page.locator("[data-deletion-id] .badge")).toBeVisible();
  });
});

test.describe("error pages in French", () => {
  test("the 404 page", async ({ page }) => {
    await signInInFrench(page);
    const response = await page.goto("/meetings/does-not-exist-123/delete");
    expect(response?.status()).toBe(404);
    expect(await htmlLang(page)).toBe("fr");
    await expect(page).toHaveTitle("Introuvable - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Introuvable" })).toBeVisible();
    await expect(
      page.getByText("Cette page n’existe pas, ou vous n’y avez pas accès."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour à vos réunions" })).toBeVisible();
  });

  test("a refused request (no CSRF token) is answered in the owner's language", async ({
    page,
  }) => {
    await signInInFrench(page);
    const origin = new URL(page.url()).origin;
    const response = await page.request.post("/settings/language", {
      headers: { origin },
      form: { language: "en" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    const html = await response.text();
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("<h1>Demande refusée</h1>");
    expect(html).toContain("Revenez en arrière, rechargez la page et réessayez.");
  });

  test("another owner who has not chosen French still gets English", async ({ page }) => {
    const other = createFreshOwner();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(other.email);
    await page.getByLabel("Password").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
    const origin = new URL(page.url()).origin;
    const response = await page.request.post("/settings/language", {
      headers: { origin },
      form: { language: "fr" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    expect(await response.text()).toContain('<html lang="en">');
    const notFound = await page.goto("/meetings/does-not-exist-123/delete");
    expect(notFound?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
  });
});
