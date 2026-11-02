import type { Page } from "@playwright/test";

/**
 * Scrolls a page that has the review's sticky publish bar to its end before an axe scan.
 *
 * The bar rests over whatever scrolls under it, and axe's target-size rule measures the viewport
 * as it stands: a button half under the bar at the fold is flagged although it is only waiting to
 * be scrolled. At the end of the page the bar rests below the last line and covers nothing, so the
 * scan sees every control whole. Every other rule reads the DOM, which does not depend on the
 * scroll position. Pages without the bar are left where they are.
 */
export async function restStickyBar(page: Page): Promise<void> {
  if ((await page.locator(".publish-bar").count()) === 0) return;
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}
