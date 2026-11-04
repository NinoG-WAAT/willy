import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  DEV_PASSWORD,
  createFreshOwner,
  ownerLanguage,
  type FreshOwner,
} from "../support/journey-db";

/**
 * The language setting (#114) on the server whose default language is English. Every owner here
 * is brand new, so no other test can change their settings. The French default is covered by
 * i18n-fr.spec.ts.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function signIn(page: Page, owner: Pick<FreshOwner, "email">): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

async function signOut(page: Page): Promise<void> {
  // On a phone Sign out lives in the tab bar's More menu; on desktop it is in the sidebar.
  if ((page.viewportSize()?.width ?? 1280) < 600) await page.locator(".tabbar summary").click();
  await page.getByRole("button", { name: SIGN_OUT }).click();
  await expect(page).toHaveURL(/\/signed-out$/);
}

/** Chooses a language through the real Settings form (never by writing to the database). */
async function chooseLanguage(page: Page, label: "English" | "Français"): Promise<void> {
  await page.goto("/settings");
  await page.getByLabel("Language / Langue").selectOption({ label });
  await page.getByRole("button", { name: /^(Save language|Enregistrer la langue)$/ }).click();
  await expect(page).toHaveURL(/\/settings\?notice=language_saved$/);
}

// The shell is still English; the French name is here so converting it does not break this spec.
const SIGN_OUT = /^(Sign out|Se déconnecter)$/;
const htmlLang = (page: Page) => page.locator("html").getAttribute("lang");

test.describe("language setting", () => {
  test("English is the default: the page says so and the selector names both languages in themselves", async ({
    page,
  }) => {
    await signIn(page, createFreshOwner());
    await page.goto("/settings");
    expect(await htmlLang(page)).toBe("en");
    await expect(page.getByRole("heading", { level: 2, name: "Language" })).toBeVisible();
    const select = page.getByLabel("Language / Langue");
    await expect(select.locator("option")).toHaveText(["English", "Français"]);
    await expect(select).toHaveValue("en");
  });

  test("choosing Français switches the page, <html lang> and the confirmation; the selector keeps its own names", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    await signIn(page, owner);
    await chooseLanguage(page, "Français");

    expect(await htmlLang(page)).toBe("fr");
    await expect(page.getByText("Langue enregistrée.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Langue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enregistrer la langue" })).toBeVisible();
    await expect(page.getByText("Aller au contenu principal")).toBeAttached();
    await expect(page.getByText("N’enregistrez qu’avec le consentement de tous.")).toBeVisible();
    // The selector never changes language: someone who cannot read French can still find English.
    const select = page.getByLabel("Language / Langue");
    await expect(select.locator("option")).toHaveText(["English", "Français"]);
    await expect(select).toHaveValue("fr");
    expect(ownerLanguage(owner.id)).toBe("fr");

    // And back.
    await chooseLanguage(page, "English");
    expect(await htmlLang(page)).toBe("en");
    await expect(page.getByText("Language saved.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Language" })).toBeVisible();
    expect(ownerLanguage(owner.id)).toBe("en");
  });

  test("the choice survives signing out and in, and another owner is not affected", async ({
    page,
    browser,
  }) => {
    const owner = createFreshOwner();
    const other = createFreshOwner();
    await signIn(page, owner);
    await chooseLanguage(page, "Français");
    await signOut(page);

    // Signed out, the server default (English here) applies: the choice belongs to the account.
    await page.goto("/sign-in");
    expect(await htmlLang(page)).toBe("en");
    await signIn(page, owner);
    await page.goto("/settings");
    expect(await htmlLang(page)).toBe("fr");
    await expect(page.getByLabel("Language / Langue")).toHaveValue("fr");

    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, other);
    await otherPage.goto("/settings");
    expect(await htmlLang(otherPage)).toBe("en");
    await expect(otherPage.getByRole("heading", { level: 2, name: "Language" })).toBeVisible();
    expect(ownerLanguage(other.id)).toBeNull();
    await otherContext.close();
  });

  test("a tampered form is refused and nothing changes (unknown value, extra owner field)", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    const victim = createFreshOwner();
    await signIn(page, owner);
    await page.goto("/settings");
    const token =
      (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
    const origin = new URL(page.url()).origin;
    const headers = { origin, "x-csrf-token": token };

    const unknown = await page.request.post("/settings/language", {
      headers,
      form: { language: "klingon" },
      maxRedirects: 0,
    });
    expect(unknown.status()).toBe(422);
    const extra = await page.request.post("/settings/language", {
      headers,
      form: { language: "fr", owner_id: victim.id },
      maxRedirects: 0,
    });
    expect(extra.status()).toBe(400);
    const noToken = await page.request.post("/settings/language", {
      headers: { origin },
      form: { language: "fr" },
      maxRedirects: 0,
    });
    expect(noToken.status()).toBe(403);
    expect(ownerLanguage(owner.id)).toBeNull();
    expect(ownerLanguage(victim.id)).toBeNull();
  });

  for (const language of ["English", "Français"] as const) {
    test(`the French page has no accessibility violations (${language} selected)`, async ({
      page,
    }) => {
      await signIn(page, createFreshOwner());
      await chooseLanguage(page, "Français");
      if (language === "English") {
        await page.getByLabel("Language / Langue").selectOption({ label: "English" });
      }
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations.map((v) => ({ rule: v.id, targets: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    });
  }

  test("the language form is a few plain words on a small screen: no horizontal scroll", async ({
    page,
  }) => {
    await signIn(page, createFreshOwner());
    await chooseLanguage(page, "Français");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("language setting without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the plain form switches the language", async ({ page }) => {
    const owner = createFreshOwner();
    await signIn(page, owner);
    await chooseLanguage(page, "Français");
    expect(await htmlLang(page)).toBe("fr");
    await expect(page.getByText("Langue enregistrée.")).toBeVisible();
    expect(ownerLanguage(owner.id)).toBe("fr");
  });
});
