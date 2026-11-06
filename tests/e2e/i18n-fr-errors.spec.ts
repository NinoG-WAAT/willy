import { expect, test, type Page } from "@playwright/test";

/**
 * The pages a signed-out visitor sees, on the server whose default language is French (#121).
 * Signed-out pages have no owner to ask, so the server default is the only way they become French.
 */

const baseURL = process.env["E2E_FR_BASE_URL"];
test.use({ ...(baseURL ? { baseURL } : {}) });

const htmlLang = (page: Page) => page.locator("html").getAttribute("lang");

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("the signed-out page is French", async ({ page }) => {
  await page.goto("/signed-out");
  expect(await htmlLang(page)).toBe("fr");
  await expect(page).toHaveTitle("Session fermée - Willycrumbs");
  await expect(
    page.getByRole("heading", { level: 1, name: "Votre session est fermée" }),
  ).toBeVisible();
  await expect(page.getByText("Votre session s’est terminée sur cet appareil.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Se connecter" })).toHaveAttribute(
    "href",
    "/sign-in",
  );
  await expectNoHorizontalScroll(page);
});

test("the session-expired page is French and keeps the way back to the page that was open", async ({
  page,
}) => {
  await page.goto("/session-expired?next=%2Fsearch%3Fq%3Dbudget");
  expect(await htmlLang(page)).toBe("fr");
  await expect(page).toHaveTitle("Session expirée - Willycrumbs");
  await expect(
    page.getByRole("heading", { level: 1, name: "Votre session a expiré" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Pour votre sécurité, votre session a été fermée après une période d’inactivité. Vos notes sont en sécurité.",
    ),
  ).toBeVisible();
  const again = page.getByRole("link", { name: "Se reconnecter" });
  await expect(again).toHaveAttribute("href", "/sign-in?next=%2Fsearch%3Fq%3Dbudget");
  await expectNoHorizontalScroll(page);
});

test("a signed-out visit to a protected page is sent to the French sign-in", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings$/);
  expect(await htmlLang(page)).toBe("fr");
});

test("a refused request from a visitor without a session is a redirect, not a page with words", async ({
  page,
}) => {
  const response = await page.request.post("/settings/language", {
    form: { language: "en" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
});
