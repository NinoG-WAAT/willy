import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PASSWORD, createFreshOwner } from "../support/journey-db";

/**
 * The lists in French (#118): the page frame and navigation, Inbox, All notes, Folders and
 * Templates, on the server whose default language is French (second server in
 * playwright.config.ts, strict mode: a `t()` without a French entry turns the page into an error).
 * Read-only checks use the seeded owner Ada; anything that writes uses a fresh owner.
 */

const baseURL = process.env["E2E_FR_BASE_URL"];
test.use({ ...(baseURL ? { baseURL } : {}) });

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const NBSP = " ";

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL("/");
}

const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 600;

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectNoEnglish(page: Page, words: readonly string[]): Promise<void> {
  const text = await page.locator("body").innerText();
  for (const word of words)
    expect(text, `English "${word}" is still on the page`).not.toContain(word);
}

async function axeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    results.violations.map((v) => ({ rule: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}

test.describe("the frame and the Inbox in French", () => {
  test("every word of the Inbox and of the navigation is French, and the layout fits", async ({
    page,
  }) => {
    await signIn(page, "ada@example.test");
    await expect(page).toHaveTitle("Boîte de réception - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Boîte de réception" })).toBeVisible();
    for (const heading of ["En cours", "À venir", "Brouillons à relire"]) {
      await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Nouvelle note" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Importer depuis le calendrier" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Importer un fichier ICS" })).toBeVisible();
    await expect(page.getByLabel("Rechercher dans vos notes")).toBeVisible();
    await expect(page.getByText(`Statut${NBSP}:`).first()).toBeVisible();
    await expect(page.getByText(`Consentement${NBSP}:`).first()).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    const links = phone(page) ? page.locator(".tabbar") : page.locator(".side-nav");
    await expect(links).toBeVisible();
    await expect(nav.first()).toBeVisible();
    await expect(links.getByText("Boîte de réception")).toBeVisible();
    await expect(links.getByText("Rechercher")).toBeVisible();
    await expect(links.getByText("Dossiers").first()).toBeVisible();

    await expectNoEnglish(page, [
      "Inbox",
      "Upcoming",
      "In progress",
      "Drafts to review",
      "Status:",
      "Consent:",
      "New note",
      "Import from",
    ]);
    await noHorizontalScroll(page);
    await axeClean(page);
  });

  test("the tab bar's labels fit on one line each on a small screen", async ({ page }) => {
    test.skip(!phone(page), "tab bar is a small-screen element");
    await signIn(page, "ada@example.test");
    const labels = page.locator(".tabbar .tab-label");
    await expect(labels).toHaveCount(4);
    for (const label of await labels.all()) {
      const box = await label.boundingBox();
      const lineHeight = await label.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      expect(box?.height ?? 0, `${await label.innerText()} wraps`).toBeLessThanOrEqual(
        lineHeight * 1.5,
      );
    }
    await page.locator(".tabbar summary").click();
    await expect(page.getByRole("link", { name: "Toutes les notes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Modèles" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Paramètres" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
  });
});

test.describe("All notes in French", () => {
  test("filters, count, empty states and pager are French", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await page.goto("/notes");
    await expect(page).toHaveTitle("Toutes les notes - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Toutes les notes" })).toBeVisible();
    await expect(
      page.getByText(/^\d+ notes?, (la plus récente|les plus récentes) d’abord\./),
    ).toBeVisible();
    const status = page.getByRole("navigation", { name: "Filtrer par statut" });
    await expect(status.getByRole("link")).toHaveText([
      "Toutes",
      "Brouillon",
      "Publiée",
      "Archivée",
    ]);
    await expect(page.getByRole("navigation", { name: "Filtrer par dossier" })).toBeVisible();
    await expectNoEnglish(page, ["Filter by", "newest first", "All folders"]);
    await noHorizontalScroll(page);
    await axeClean(page);

    await page.goto("/notes?status=archived&folder=does-not-exist");
    await expect(
      page.getByRole("heading", { level: 2, name: "Aucune note ne correspond" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Effacer les filtres" })).toBeVisible();
  });

  test("a new owner sees the French empty state", async ({ page }) => {
    const owner = createFreshOwner("fr");
    await signIn(page, owner.email);
    await page.goto("/notes");
    await expect(
      page.getByRole("heading", { level: 2, name: "Aucune note pour l’instant" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Créer une note" })).toBeVisible();
    await noHorizontalScroll(page);
  });
});

test.describe("Folders in French", () => {
  test("create, refuse a duplicate, rename, open, and delete a folder, all in French", async ({
    page,
  }) => {
    const owner = createFreshOwner("fr");
    await signIn(page, owner.email);
    await page.goto("/folders");
    await expect(page).toHaveTitle("Dossiers - Willycrumbs");
    await expect(page.getByText("Vous n’avez pas encore de dossier.")).toBeVisible();

    await page.getByLabel("Nom du dossier").fill("Clients");
    await page.getByRole("button", { name: "Créer le dossier" }).click();
    await expect(page.getByText("Dossier créé.")).toBeVisible();
    await expect(page.getByText("0 note", { exact: true })).toBeVisible();

    await page.getByLabel("Nom du dossier").fill("clients");
    await page.getByRole("button", { name: "Créer le dossier" }).click();
    await expect(page.locator(".field-error")).toHaveText(
      "Vous avez déjà un dossier portant ce nom.",
    );

    await page.getByLabel("Nouveau nom du dossier Clients").fill("Prospects");
    await page.getByRole("button", { name: "Renommer Clients" }).click();
    await expect(page.getByText("Dossier renommé.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Prospects" }).first()).toBeVisible();
    await expectNoEnglish(page, ["Folders", "Rename", "Delete", "Your folders"]);
    await noHorizontalScroll(page);
    await axeClean(page);

    await page.getByRole("link", { name: "Prospects" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Prospects" })).toBeVisible();
    await expect(page.getByText("Rien n’a encore été publié ici")).toBeVisible();
    await expect(page.getByText(`0 note · Privé`)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Fil d’Ariane" })).toBeVisible();
    await noHorizontalScroll(page);

    await page.goto("/folders");
    await page.getByRole("link", { name: "Supprimer le dossier Prospects" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Supprimer le dossier" }),
    ).toBeVisible();
    await expect(
      page.getByText("Vous êtes sur le point de supprimer le dossier Prospects."),
    ).toBeVisible();
    await expect(page.getByText("Portée", { exact: false })).toBeVisible();
    await expect(page.getByText("Ce dossier contient 0 note.")).toBeVisible();
    await noHorizontalScroll(page);
    await axeClean(page);
    await page.getByRole("button", { name: "Supprimer le dossier" }).click();
    await expect(page.getByText("Dossier supprimé.")).toBeVisible();
  });

  test("a folder that holds notes cannot be deleted, and the page says so in French", async ({
    page,
  }) => {
    await signIn(page, "ada@example.test");
    // Ada's board folder holds a published note.
    await page.goto("/folders/folder-a-board/delete");
    await expect(
      page.getByRole("heading", { level: 1, name: "Supprimer le dossier" }),
    ).toBeVisible();
    await expect(page.getByText(/^Ce dossier contient \d+ notes?\.$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour aux dossiers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Supprimer le dossier" })).toHaveCount(0);
    await expectNoEnglish(page, ["You are about", "Scope", "Back to folders"]);
    await noHorizontalScroll(page);
  });
});

test.describe("Templates in French", () => {
  test("create with a mistake, fix it, make default, edit and delete, all in French", async ({
    page,
  }) => {
    const owner = createFreshOwner("fr");
    await signIn(page, owner.email);
    await page.goto("/settings/templates");
    await expect(page).toHaveTitle("Modèles - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Modèles" })).toBeVisible();
    await expect(page.getByText("Vous n’avez pas encore de modèle.")).toBeVisible();

    await page.getByRole("link", { name: "Nouveau modèle" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Nouveau modèle" })).toBeVisible();
    await page.getByLabel("Nom du modèle").fill("Appel client");
    await page.locator("#section-0-heading").fill("Bilan");
    await page.locator("#section-1-heading").fill("bilan");
    await expectNoEnglish(page, ["Template name", "Heading", "Prompt", "Cancel"]);
    await noHorizontalScroll(page);
    await axeClean(page);
    await page.getByRole("button", { name: "Créer le modèle" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Corrigez les points suivants avant d’enregistrer",
    );
    await expect(page.getByRole("alert")).toContainText(
      "Chaque section doit avoir un titre différent.",
    );
    await noHorizontalScroll(page);

    await page.locator("#section-1-heading").fill("Suites");
    await page.getByRole("button", { name: "Créer le modèle" }).click();
    await expect(page.getByText("Modèle créé.")).toBeVisible();
    await expect(page.getByText("Utilisé par 0 réunion.")).toBeVisible();
    await expect(page.getByText(new RegExp(`^\\d+ sections?${NBSP}: `))).toBeVisible();

    await page.getByRole("button", { name: "Définir par défaut le modèle Appel client" }).click();
    await expect(page.getByText("Modèle par défaut mis à jour.")).toBeVisible();
    await expect(page.locator(".badge", { hasText: "Par défaut" })).toBeVisible();
    await noHorizontalScroll(page);
    await axeClean(page);

    await page.getByRole("link", { name: "Modifier le modèle Appel client" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Modifier le modèle" })).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer le modèle" }).click();
    await expect(page.getByText("Modèle enregistré.")).toBeVisible();

    await page.getByRole("link", { name: "Supprimer le modèle Appel client" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Supprimer le modèle" }),
    ).toBeVisible();
    await expect(page.getByText("Aucune réunion n’utilise ce modèle.")).toBeVisible();
    await expect(page.getByText("C’est votre modèle par défaut")).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "Supprimer le modèle" }).click();
    await expect(page.getByText("Modèle supprimé.")).toBeVisible();
  });
});
