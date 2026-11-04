import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PASSWORD, createFreshOwner, ownerLanguage } from "../support/journey-db";

/**
 * The French default (#114): the same build, started with WILLY_DEFAULT_LOCALE=fr and
 * WILLY_I18N_STRICT=1 (second server in playwright.config.ts). Signed-out pages can only be French
 * through this default, which is why the sign-in screen is tested here. Strict mode means a
 * `t()` without a French entry would turn these pages into an error page instead of English.
 */

const baseURL = process.env["E2E_FR_BASE_URL"];
test.use({ ...(baseURL ? { baseURL } : {}) });

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
// The shell is still English; the French name is here so converting it does not break this spec.
const SIGN_OUT = /^(Sign out|Se déconnecter)$/;
const htmlLang = (page: Page) => page.locator("html").getAttribute("lang");

async function fillAndSubmit(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test.describe("sign-in screen in French", () => {
  test("every word on the screen is French, and the page says it is French", async ({ page }) => {
    await page.goto("/sign-in");
    expect(await htmlLang(page)).toBe("fr");
    await expect(page).toHaveTitle("Se connecter - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Se connecter" })).toBeVisible();
    await expect(page.getByLabel("Adresse e-mail")).toHaveAttribute("autocomplete", "username");
    await expect(page.getByLabel("Mot de passe")).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
    await expect(page.getByText("N’enregistrez qu’avec le consentement de tous.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Aller au contenu principal" })).toBeAttached();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a wrong password shows the generic French error and does not sign in", async ({ page }) => {
    await page.goto("/sign-in");
    await fillAndSubmit(page, "ada@example.test", "wrong-password");
    await expect(page.getByRole("alert")).toHaveText("Adresse e-mail ou mot de passe incorrect.");
    expect(await htmlLang(page)).toBe("fr");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("the sign-in screen has no accessibility violations in French, with or without an error", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    const clean = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(clean.violations.map((v) => v.id)).toEqual([]);
    await fillAndSubmit(page, "ada@example.test", "wrong-password");
    await expect(page.getByRole("alert")).toBeVisible();
    const withError = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(withError.violations.map((v) => v.id)).toEqual([]);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the plain form signs in and reports a mistake in French", async ({ page }) => {
      const owner = createFreshOwner("fr");
      await page.goto("/sign-in");
      await fillAndSubmit(page, owner.email, "wrong-password");
      await expect(page.getByRole("alert")).toHaveText("Adresse e-mail ou mot de passe incorrect.");
      await fillAndSubmit(page, owner.email, DEV_PASSWORD);
      await expect(page).toHaveURL("/");
    });
  });
});

test.describe("owner setting against the server default", () => {
  test("an owner who has not chosen gets French; choosing English wins over the default, after sign-out too", async ({
    page,
  }) => {
    const owner = createFreshOwner("fr");
    await page.goto("/sign-in");
    await fillAndSubmit(page, owner.email, DEV_PASSWORD);
    await expect(page).toHaveURL("/");

    await page.goto("/settings");
    expect(await htmlLang(page)).toBe("fr");
    await expect(page.getByLabel("Language / Langue")).toHaveValue("fr");
    expect(ownerLanguage(owner.id, "fr")).toBeNull();

    await page.getByLabel("Language / Langue").selectOption({ label: "English" });
    await page.getByRole("button", { name: "Enregistrer la langue" }).click();
    await expect(page.getByText("Language saved.")).toBeVisible();
    expect(await htmlLang(page)).toBe("en");
    expect(ownerLanguage(owner.id, "fr")).toBe("en");

    // Signed out, the server default (French) applies again; signed in, the owner's English wins.
    if ((page.viewportSize()?.width ?? 1280) < 600) await page.locator(".tabbar summary").click();
    await page.getByRole("button", { name: SIGN_OUT }).click();
    await page.goto("/sign-in");
    expect(await htmlLang(page)).toBe("fr");
    await fillAndSubmit(page, owner.email, DEV_PASSWORD);
    await expect(page).toHaveURL("/");
    await page.goto("/settings");
    expect(await htmlLang(page)).toBe("en");
    await expect(page.getByRole("heading", { level: 2, name: "Language" })).toBeVisible();
  });
});
