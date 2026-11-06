import { expect, type Page, type Response } from "@playwright/test";
import { englishLeftovers } from "./english-words";
import { DEV_PASSWORD, createFreshOwner, type FreshOwner } from "./journey-db";

/**
 * Helpers of the French crawl (#128): signing in as an owner who chose Français, and checking a
 * page for English left in the interface (the word scanner is in `english-words.ts`).
 */

/** Everything a person can read or hear on the page: text nodes, labels, titles and alt texts. */
export async function chromeTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [document.title];
    const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent && skip.has(parent.tagName)) continue;
      const text = node.nodeValue?.trim() ?? "";
      if (text !== "") out.push(text);
    }
    for (const el of document.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
      for (const name of ["aria-label", "title", "placeholder", "alt"]) {
        const value = el.getAttribute(name);
        if (value !== null && value.trim() !== "") out.push(value);
      }
    }
    for (const el of document.querySelectorAll<HTMLInputElement>(
      "input[type=submit], input[type=button]",
    )) {
      if (el.value.trim() !== "") out.push(el.value);
    }
    return out;
  });
}

/**
 * Opens every disclosure so text inside closed `<details>` is checked too; returns a function
 * that closes again the ones it opened (the phone's More menu must not stay open over the page).
 */
async function openAllDetails(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("details:not([open])")) {
      el.setAttribute("open", "");
      el.setAttribute("data-crawl-opened", "");
    }
  });
  return async () => {
    await page.evaluate(() => {
      for (const el of document.querySelectorAll("details[data-crawl-opened]")) {
        el.removeAttribute("open");
        el.removeAttribute("data-crawl-opened");
      }
    });
  };
}

export interface CrawlOptions {
  /** Expected HTTP status; 200 by default. */
  status?: number;
  /** What the owner wrote on this page (removed before the English scan). */
  ownerText?: readonly (string | RegExp)[];
}

/** Sign in on the English server, then choose Français in the real Settings form. */
export async function signInAsFrenchOwner(page: Page): Promise<FreshOwner> {
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
  return owner;
}

/** The page the person is on must be French, fit its window and have no English left. */
export async function expectFrenchPage(page: Page, label: string, options: CrawlOptions = {}) {
  expect(await page.locator("html").getAttribute("lang"), `${label}: <html lang>`).toBe("fr");
  // The layout as the person sees it, before any disclosure is opened for the scan.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(
    overflow,
    `${label}: horizontal scroll (px) at ${String(page.viewportSize()?.width)}`,
  ).toBeLessThanOrEqual(0);
  const closeAgain = await openAllDetails(page);
  const found = englishLeftovers(await chromeTexts(page), options.ownerText);
  await closeAgain();
  // Each word once with the first text it was in, so a failure reads as a short list.
  const hits = [...new Map(found.map((hit) => [hit.word.toLowerCase(), hit])).values()];
  expect(hits, `${label}: English left on the page`).toEqual([]);
}

/** Visits a URL, expects the status (200 unless told) and a clean French page. */
export async function crawl(
  page: Page,
  path: string,
  options: CrawlOptions = {},
): Promise<Response | null> {
  const response = await page.goto(path);
  expect(response?.status(), `${path}: HTTP status (a strict-mode miss is a 500)`).toBe(
    options.status ?? 200,
  );
  await expectFrenchPage(page, path, options);
  return response;
}
