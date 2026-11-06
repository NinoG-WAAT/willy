import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addOutlineItems,
  advanceProcessing,
  createReviewMeeting,
  reviewFolderName,
} from "../support/e2e-db";
import { restStickyBar } from "../support/sticky-bar";
import { DEV_PASSWORD, createFreshOwner } from "../support/journey-db";

/**
 * The review screen in French (#120). The owner is brand new and chooses Français in the real
 * Settings form, so no other spec can see this data. Both servers run in strict mode: a `t()`
 * without a French entry would turn the page into an error page. Only the review area's words
 * are asserted; the page frame and meeting header are converted by their own packages.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const NBSP = " ";

async function frenchOwner(page: Page) {
  const owner = createFreshOwner();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings");
  await page.getByLabel("Language / Langue").selectOption({ label: "Français" });
  await page.getByRole("button", { name: /^(Save language|Enregistrer la langue)$/ }).click();
  await expect(page).toHaveURL(/\/settings\?notice=language_saved$/);
  const id = await createReviewMeeting(owner.id);
  addOutlineItems(id);
  return { owner, id };
}

const noHorizontalScroll = async (page: Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

/** French is longer than English: its buttons, summaries and links must still be 44px targets. */
async function expectHitTargets(page: Page): Promise<void> {
  const small = await page.evaluate(() => {
    const controls = document.querySelectorAll<HTMLElement>(
      "#summary button, #summary summary, #summary a.outline-link, #summary a.source-chip, #summary a.rl-edit, #transcript button, #transcript summary, .publish-bar button, .publish-bar summary",
    );
    return [...controls]
      .filter((el) => el.getClientRects().length > 0 && !el.classList.contains("sr-only"))
      .map((el) => [el.textContent.trim().slice(0, 30), el.getBoundingClientRect().height] as const)
      .filter(([, height]) => height < 43.5)
      .map(([name, height]) => `${name} ${String(Math.round(height))}px`);
  });
  expect(small, "controls shorter than 44px").toEqual([]);
}

test("the draft review reads in French, from the summary to the transcript", async ({ page }) => {
  const { id } = await frenchOwner(page);
  await page.goto(`/meetings/${id}/review`);
  expect(await page.locator("html").getAttribute("lang")).toBe("fr");

  await expect(page.getByRole("heading", { level: 2, name: "Résumé de la réunion" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Décisions" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Actions" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Intervenants" })).toBeVisible();
  // The jump link is for the stacked phone layout; on a desktop the transcript is beside the summary.
  await expect(page.locator("a.jump-link")).toHaveText("Aller à la transcription");
  await expect(page).toHaveTitle(/^Relecture\s: /);

  // An overdue open action item: said in words, in French, with the due day in French too.
  const overdue = page.locator(`#action-${id}-act-3`);
  await expect(overdue).toContainText("En retard");
  await expect(overdue).toContainText(`Échéance${NBSP}: `);
  await expect(overdue).toContainText("janv. 2020");
  await expect(overdue.getByLabel(/^Marquer comme terminée/)).not.toBeChecked();

  // The owner's own words are never translated.
  await expect(page.locator(`#decision-${id}-dec-1`)).toContainText(
    "Hire a product designer in the first quarter",
  );
  await expect(page.getByText("Speaker 1").first()).toBeVisible();

  // The closed transcript panel says what it holds, in French, with a French plural.
  await expect(page.locator("#transcript-panel > summary")).toHaveText(
    `Transcription${NBSP}: 0:00, 3 lignes`,
  );
  await expect(page.locator(".speaker-lines").first()).toHaveText(/^\d+ lignes?$/);

  // Publishing: the bar and its form.
  await page.locator(".publish-details > summary").click();
  await expect(page.getByLabel("Dossier privé")).toBeVisible();
  await expect(page.getByLabel("J’ai relu cette note et je souhaite la publier.")).toBeVisible();
  await noHorizontalScroll(page);
});

test("a rejected edit, a speaker rename and the publish confirmation explain themselves in French", async ({
  page,
}) => {
  const { id } = await frenchOwner(page);
  await page.goto(`/meetings/${id}/review?edit=${id}-dec-1#decision-${id}-dec-1`);
  await page.locator(`#decision-text-${id}-dec-1`).fill("   ");
  await page.getByRole("button", { name: /^Enregistrer la décision/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Rien n’a été enregistré. Corrigez le problème signalé et réessayez.",
  );
  await expect(page.locator(".field-error")).toHaveText("Décrivez la décision.");

  await page.goto(`/meetings/${id}/review`);
  await page.getByText("Renommer ou fusionner des intervenants", { exact: true }).click();
  await page.getByRole("button", { name: "Renommer l’intervenant" }).click();
  await expect(page.locator(".field-error")).toHaveText("Saisissez un nom.");

  await page.goto(`/meetings/${id}/review`);
  await page.locator(".publish-details > summary").click();
  await page.getByRole("button", { name: "Publier dans un dossier" }).last().click();
  await expect(page.locator(".field-error")).toHaveText(
    "Cochez la case pour confirmer la publication.",
  );
});

test("publishing and reopening show French notices and the published state", async ({ page }) => {
  const { id } = await frenchOwner(page);
  await page.goto(`/meetings/${id}/review`);
  await page.locator(".publish-details > summary").click();
  await page.getByLabel("Dossier privé").selectOption({ label: reviewFolderName(id) });
  await page.getByLabel("J’ai relu cette note et je souhaite la publier.").check();
  await page.getByRole("button", { name: "Publier dans un dossier" }).last().click();

  await expect(page.getByRole("status").filter({ hasText: "Publiée." })).toContainText(
    "Cette note n’est plus un brouillon.",
  );
  await expect(page.getByRole("heading", { level: 2, name: "Publiée" })).toBeVisible();
  await expect(page.locator("#publish")).toContainText(`Publiée dans ${reviewFolderName(id)} le `);
  await expect(page.locator("#publish")).toContainText("Cette version est en lecture seule.");

  await page.getByRole("button", { name: "Rouvrir pour modifier" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Rouverte." })).toBeVisible();
});

test("following a source chip marks the lines and announces it in French", async ({ page }) => {
  const { id } = await frenchOwner(page);
  await page.goto(`/meetings/${id}/review`);
  await page.locator(`#decision-${id}-dec-0 a.source-chip`).click();
  await expect(page.locator("#source-status")).toHaveText(
    /^\d+ lignes? de transcription citées? (est|sont) marquées?\.$/,
  );
  await expect(page.locator("li.is-source .seg-flag").first()).toHaveText("Citée");
});

test("job progress is written in French, on load and after a live update", async ({ page }) => {
  const { id } = await frenchOwner(page);
  advanceProcessing(id, { meeting: "processing", transcription: "running", summary: "pending" });
  await page.goto(`/meetings/${id}/review`);
  const region = page.locator("#processing-progress");
  await expect(region).toContainText(`Transcription${NBSP}: En cours`);
  await expect(region).toContainText(`Résumé${NBSP}: En attente de démarrage`);
  advanceProcessing(id, { meeting: "failed", transcription: "failed" });
  // The polling script uses the same words as the server, from the small client catalog.
  await expect(region).toContainText("Le traitement ne s’est pas terminé.", { timeout: 20_000 });
  await expect(region).toContainText(`Échec après`);
  await expect(region).toContainText("Vos notes brutes sont conservées.");
});

test("the French review has no accessibility violations and fits a phone", async ({ page }) => {
  const { id } = await frenchOwner(page);
  await page.goto(`/meetings/${id}/review`);
  const scan = async (include?: string) => {
    await restStickyBar(page);
    const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
    return (include ? builder.include(include) : builder).analyze();
  };
  expect((await scan()).violations.map((v) => v.id)).toEqual([]);
  await noHorizontalScroll(page);
  await expectHitTargets(page);

  // Opening a disclosure scrolls the page, and the sticky publish bar then covers whatever is
  // at the bottom edge of the window: so each opened region is checked on its own.
  await page.locator("#transcript-panel > summary").click();
  await page.getByText("Renommer ou fusionner des intervenants", { exact: true }).click();
  expect((await scan("#transcript")).violations.map((v) => v.id)).toEqual([]);
  await page.locator(".publish-details > summary").click();
  expect((await scan("#publish")).violations.map((v) => v.id)).toEqual([]);
  await noHorizontalScroll(page);
  await expectHitTargets(page);

  await page.goto(`/meetings/${id}/review?edit=${id}-act-1#action-${id}-act-1`);
  expect((await scan(`#action-${id}-act-1`)).violations.map((v) => v.id)).toEqual([]);
  await noHorizontalScroll(page);
});
