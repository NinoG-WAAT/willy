import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { createCapturingMeeting } from "../support/e2e-db";
import { createFolderWithNotes } from "../support/folder-fixtures";
import { createFreshOwner } from "../support/journey-db";

/**
 * The persistent app shell (issue #70): a sidebar on desktop (>= 60rem), a bottom tab bar on a
 * phone, on every signed-in page and on none of the standalone ones. Runs in both Playwright
 * projects (desktop 1280 wide, phone 390x844); tests that only make sense in one skip in the other.
 */

const PASSWORD = "willy-dev-password";
const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 600;

async function signIn(page: Page, email = "ada@example.test"): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

/** A browser context signed in as a brand-new owner, so the test owns its folders. */
async function asFreshOwner(
  browser: Browser,
  viewport: { width: number; height: number } | null,
): Promise<{ page: Page; ownerId: string; close: () => Promise<void> }> {
  const owner = createFreshOwner();
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await signIn(page, owner.email);
  return { page, ownerId: owner.id, close: () => context.close() };
}

const mainNav = (page: Page): Locator => page.getByRole("navigation", { name: "Main" });

/** The links of the folder list in the sidebar (everything under /folders/<id>). */
const sidebarFolderLinks = (page: Page): Locator => mainNav(page).locator('a[href^="/folders/"]');

const SHELL_PAGES: [string, string][] = [
  ["the Inbox", "/"],
  ["all notes", "/notes"],
  ["search", "/search"],
  ["folders", "/folders"],
  ["a folder", "/folders/folder-a-board"],
  ["templates", "/settings/templates"],
  ["settings", "/settings"],
  ["a meeting", "/meetings/meeting-a-published"],
  ["a review", "/meetings/meeting-a-published/review"],
  ["the new note form", "/meetings/new"],
];

test.describe("the shell is on every signed-in page", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const [name, path] of SHELL_PAGES) {
    test(`${name} (${path}) has the navigation, New note and Sign out`, async ({ page }) => {
      await page.goto(path);
      await expect(mainNav(page)).toBeVisible();
      await expect(page.getByRole("banner").getByRole("link", { name: "New note" })).toBeVisible();
      await expect(
        page.getByRole("banner").getByRole("link", { name: "New note" }),
      ).toHaveAttribute("href", "/meetings/new");
      if (isPhone(page)) {
        for (const label of ["Inbox", "Search", "Folders"]) {
          await expect(mainNav(page).getByRole("link", { name: label, exact: true })).toBeVisible();
        }
        await expect(mainNav(page).locator("summary")).toHaveText("More");
        await expect(mainNav(page).getByRole("link", { name: "Templates" })).toBeHidden();
        await expect(mainNav(page).getByRole("link", { name: "All notes" })).toBeHidden();
      } else {
        for (const label of [
          "Inbox",
          "All notes",
          "Search",
          "All folders",
          "Templates",
          "Settings",
        ]) {
          await expect(mainNav(page).getByRole("link", { name: label, exact: true })).toBeVisible();
        }
        await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      }
    });
  }

  test("a scheduled meeting's live note has the shell too", async ({ page }) => {
    const id = createCapturingMeeting("owner-ada", "scheduled", "Shell scheduled");
    await page.goto(`/meetings/${id}`);
    await expect(mainNav(page)).toBeVisible();
  });

  test("the 404 page of a signed-in owner has the shell", async ({ page }) => {
    const response = await page.goto("/meetings/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(mainNav(page)).toBeVisible();
  });

  test("landmarks: one banner, one main, one footer, navigations named differently", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    const names = await page
      .getByRole("navigation")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(names.every((n) => n !== null && n !== "")).toBe(true);
    expect(new Set(names).size, `navigation names ${names.join(", ")}`).toBe(names.length);
  });
});

test.describe("standalone pages have no shell", () => {
  for (const path of ["/sign-in", "/signed-out", "/session-expired"]) {
    test(`${path} signed out`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "New note" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
      // The plain frame stays: brand, one main, the consent line.
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
    });
  }

  test("the signed-out and session-expired pages stay bare even with a live session", async ({
    page,
  }) => {
    await signIn(page);
    for (const path of ["/signed-out", "/session-expired"]) {
      await page.goto(path);
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "New note" })).toHaveCount(0);
    }
  });

  test("a signed-out visitor sent to sign-in sees the bare frame", async ({ page }) => {
    await page.goto("/search");
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });
});

test.describe("the current item is marked", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  const section = (page: Page, label: string): Locator =>
    mainNav(page).getByRole("link", { name: label, exact: true });

  test("search, with the others unmarked", async ({ page }) => {
    await page.goto("/search");
    await expect(section(page, "Search")).toHaveAttribute("aria-current", "page");
    await expect(section(page, "Inbox")).not.toHaveAttribute("aria-current");
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveCount(1);
  });

  test("the Inbox, and meeting pages belong to the Inbox", async ({ page }) => {
    await page.goto("/");
    await expect(section(page, "Inbox")).toHaveAttribute("aria-current", "page");
    await page.goto("/meetings/new");
    await expect(section(page, "Inbox")).toHaveAttribute("aria-current", "page");
  });

  test("All notes (on a phone it is in the More menu, which shows it holds the page)", async ({
    page,
  }) => {
    await page.goto("/notes");
    if (isPhone(page)) {
      await expect(mainNav(page).locator("summary")).toHaveAttribute("aria-current", "true");
      await mainNav(page).locator("summary").click();
    }
    await expect(section(page, "All notes")).toHaveAttribute("aria-current", "page");
    await expect(section(page, "Inbox")).not.toHaveAttribute("aria-current");
  });

  test("the folders index", async ({ page }) => {
    await page.goto("/folders");
    await expect(
      mainNav(page).getByRole("link", { name: isPhone(page) ? "Folders" : "All folders" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("a nested settings page marks Templates, not Settings", async ({ page }) => {
    await page.goto("/settings/templates/new");
    if (isPhone(page)) {
      // Templates and Settings live in the More menu; the menu itself shows it holds the page.
      await expect(mainNav(page).locator("summary")).toHaveAttribute("aria-current", "true");
      await mainNav(page).locator("summary").click();
    }
    await expect(section(page, "Templates")).toHaveAttribute("aria-current", "page");
    await expect(section(page, "Settings")).not.toHaveAttribute("aria-current");
  });

  test("the current item differs from the others by more than colour", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/search");
    const cue = (label: string): Promise<string> =>
      section(page, label).evaluate((el) => {
        const s = getComputedStyle(el);
        return [
          s.fontWeight,
          s.textDecorationLine,
          s.borderInlineStartWidth,
          s.borderTopWidth,
          s.borderBottomWidth,
        ].join("|");
      });
    expect(await cue("Search")).not.toBe(await cue("Inbox"));
  });
});

test.describe("the folder list (desktop sidebar)", () => {
  test.beforeEach(({ page }) => {
    test.skip(isPhone(page), "the sidebar is a desktop layout");
  });

  test("lists the owner's folders with their counts, as links", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    const link = mainNav(page).getByRole("link", { name: /^Board updates\s+1 note$/ });
    await expect(link).toHaveAttribute("href", "/folders/folder-a-board");
    await link.click();
    await expect(page).toHaveURL(/\/folders\/folder-a-board$/);
    await expect(page.getByRole("heading", { level: 1, name: "Board updates" })).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: "All folders" })).toHaveAttribute(
      "href",
      "/folders",
    );
  });

  test("a count is words for a screen reader: none, one, many", async ({ browser }) => {
    const { page, ownerId, close } = await asFreshOwner(browser, null);
    createFolderWithNotes(ownerId, "Empty one", []);
    createFolderWithNotes(ownerId, "Single", [
      { title: "Only", startsAt: "2026-08-01T09:00:00.000Z" },
    ]);
    createFolderWithNotes(ownerId, "Pair", [
      { title: "One", startsAt: "2026-08-01T09:00:00.000Z" },
      { title: "Two", startsAt: "2026-08-02T09:00:00.000Z" },
    ]);
    await page.goto("/");
    await expect(mainNav(page).getByRole("link", { name: /^Empty one\s+0 notes$/ })).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: /^Single\s+1 note$/ })).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: /^Pair\s+2 notes$/ })).toBeVisible();
    await close();
  });

  test("never lists another owner's folders, in either direction", async ({ browser, page }) => {
    const other = createFreshOwner();
    const secret = `Confidential ${other.id.slice(-8)}`;
    createFolderWithNotes(other.id, secret, []);
    await signIn(page);
    for (const path of ["/", "/folders", "/folders/folder-a-board"]) {
      await page.goto(path);
      await expect(page.locator("body")).not.toContainText(secret);
    }
    const { page: theirs, close } = await asFreshOwner(browser, null);
    await theirs.goto("/");
    await expect(theirs.locator("body")).not.toContainText("Board updates");
    await close();
  });

  test("says so when there are no folders, and still links to All folders", async ({ browser }) => {
    const { page, close } = await asFreshOwner(browser, null);
    await page.goto("/");
    await expect(mainNav(page)).toContainText("No folders yet");
    await expect(sidebarFolderLinks(page)).toHaveCount(0);
    await expect(mainNav(page).getByRole("link", { name: "All folders" })).toHaveAttribute(
      "href",
      "/folders",
    );
    await close();
  });

  test("is capped at eight folders; All folders has them all", async ({ browser }) => {
    const { page, ownerId, close } = await asFreshOwner(browser, null);
    for (let i = 1; i <= 10; i += 1) {
      createFolderWithNotes(ownerId, `Folder ${String(i).padStart(2, "0")}`, []);
    }
    await page.goto("/");
    await expect(sidebarFolderLinks(page)).toHaveCount(8);
    await expect(sidebarFolderLinks(page).first()).toContainText("Folder 01");
    await expect(sidebarFolderLinks(page).last()).toContainText("Folder 08");
    // On a short window the sidebar scrolls inside itself, and Sign out stays within reach.
    await page.setViewportSize({ width: 1280, height: 560 });
    await expect(page.getByRole("button", { name: "Sign out" })).toBeInViewport();
    await mainNav(page).getByRole("link", { name: "All folders" }).scrollIntoViewIfNeeded();
    await mainNav(page).getByRole("link", { name: "All folders" }).click();
    await expect(page.getByRole("main").getByRole("link", { name: /^Folder 10$/ })).toBeVisible();
    await close();
  });

  test("highlights the open folder, and the folder of a filed note", async ({ page }) => {
    await signIn(page);
    await page.goto("/folders/folder-a-board");
    const link = mainNav(page).locator('a[href="/folders/folder-a-board"]');
    await expect(link).toHaveAttribute("aria-current", "page");
    // Its delete confirmation is a sub-page: the folder stays active, but it is not the page.
    await page.goto("/folders/folder-a-board/delete");
    await expect(link).toHaveAttribute("aria-current", "true");
    // The published note of that folder.
    await page.goto("/meetings/meeting-a-published/review");
    await expect(link).toHaveAttribute("aria-current", "true");
    // A note that is in no folder highlights none.
    await page.goto("/meetings/meeting-a-empty");
    await expect(sidebarFolderLinks(page).locator("xpath=self::*[@aria-current]")).toHaveCount(0);
  });
});

test.describe("desktop layout", () => {
  test.beforeEach(({ page }) => {
    test.skip(isPhone(page), "desktop layout only");
  });

  test("a sticky left column beside the content; the content keeps its readable width", async ({
    page,
  }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto("/");
    const nav = await page.getByRole("banner").boundingBox();
    const main = await page.getByRole("main").boundingBox();
    if (!nav || !main) throw new Error("boxes are missing");
    expect(nav.x).toBe(0);
    expect(nav.width).toBeGreaterThanOrEqual(220);
    expect(nav.width).toBeLessThanOrEqual(280);
    expect(main.x).toBeGreaterThanOrEqual(nav.x + nav.width - 1);
    expect(main.width).toBeLessThanOrEqual(1232 + 1);
    expect(await page.getByRole("banner").evaluate((el) => getComputedStyle(el).position)).toBe(
      "sticky",
    );
  });

  test("the sidebar stays in view while a long page scrolls", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto("/meetings/meeting-a-overdue/review");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const top = await page.getByRole("banner").evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(top)).toBeLessThan(1);
    await expect(mainNav(page).getByRole("link", { name: "Search" })).toBeInViewport();
  });

  test("the sidebar starts at 960px; below it the tab bar takes over", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 960, height: 800 });
    await page.goto("/");
    await expect(mainNav(page).getByRole("link", { name: "All folders" })).toBeVisible();
    await page.setViewportSize({ width: 959, height: 800 });
    await expect(mainNav(page).getByRole("link", { name: "All folders" })).toBeHidden();
    await expect(mainNav(page).locator("summary")).toBeVisible();
  });

  test("the review keeps its two columns when the sidebar leaves 960px for the page", async ({
    page,
  }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/meetings/meeting-a-overdue/review");
    const grid = page.locator(".review-grid");
    const columns = await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(columns).toBe(2);
    await page.setViewportSize({ width: 1000, height: 900 });
    const narrow = await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(narrow, "one column when the content area is too narrow for two").toBe(1);
  });
});

test.describe("phone tab bar", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isPhone(page), "phone layout only");
    await signIn(page);
  });

  const tabbar = (page: Page): Locator => page.locator(".tabbar");

  test("is fixed to the bottom edge, one row of four tabs, each a 44px target", async ({
    page,
  }) => {
    await page.goto("/");
    const height = page.viewportSize()?.height ?? 0;
    const box = await tabbar(page).boundingBox();
    if (!box) throw new Error("the tab bar is missing");
    expect(Math.abs(box.y + box.height - height)).toBeLessThanOrEqual(1);
    expect(await tabbar(page).evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    const tabs = await tabbar(page)
      .locator(".tab")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { y: Math.round(r.y), w: r.width, h: r.height, right: r.right };
        }),
      );
    expect(tabs).toHaveLength(4);
    expect(new Set(tabs.map((t) => t.y)).size, "one row").toBe(1);
    for (const t of tabs) {
      expect(t.h).toBeGreaterThanOrEqual(44);
      expect(t.w).toBeGreaterThanOrEqual(44);
      expect(t.right).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    }
    // It scrolls with nothing: still at the bottom after the page moves.
    await page.evaluate(() => window.scrollTo(0, 300));
    const after = await tabbar(page).boundingBox();
    expect(after?.y).toBe(box.y);
  });

  for (const path of [
    "/",
    "/settings",
    "/search?q=roadmap",
    "/meetings/meeting-a-overdue/review",
  ]) {
    test(`does not cover the bottom of the page: ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const footer = await page.getByRole("contentinfo").boundingBox();
      const bar = await tabbar(page).boundingBox();
      if (!footer || !bar) throw new Error("boxes are missing");
      expect(footer.y + footer.height).toBeLessThanOrEqual(bar.y + 1);
    });
  }

  test("does not cover the sticky recording banner or the controls under it", async ({ page }) => {
    const id = createCapturingMeeting("owner-ada", "capturing", "Shell recording");
    await page.goto(`/meetings/${id}`);
    const banner = page.locator("#rec-banner");
    await expect(banner).toBeVisible();
    const bar = await tabbar(page).boundingBox();
    if (!bar) throw new Error("the tab bar is missing");
    for (const y of [0, 250, 100000]) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      const b = await banner.boundingBox();
      if (!b) throw new Error("the banner is missing");
      expect(b.y, `banner stays at the top (scrolled to ${String(y)})`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(bar.y);
    }
    // At the very bottom the last control is not hidden behind the tab bar either.
    const last = await page.locator("main").evaluate((el) => el.getBoundingClientRect().bottom);
    expect(last).toBeLessThanOrEqual(bar.y + 1);
  });

  test("More opens Templates, Settings and Sign out without any script, and shows where you are", async ({
    page,
  }) => {
    await page.goto("/");
    const more = tabbar(page).locator("summary");
    await expect(more).not.toHaveAttribute("aria-current");
    await more.click();
    for (const label of ["Templates", "Settings"]) {
      await expect(tabbar(page).getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(tabbar(page).getByRole("button", { name: "Sign out" })).toBeVisible();
    await tabbar(page).getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(more).toHaveAttribute("aria-current", "true");
  });

  test("signing out from More ends the session", async ({ page }) => {
    await page.goto("/");
    await tabbar(page).locator("summary").click();
    await tabbar(page).getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signed-out$/);
  });

  test("honours the safe-area inset (home indicator, notch)", async ({ page }) => {
    await page.goto("/");
    const rules = await page.evaluate(() =>
      [...document.styleSheets].flatMap((sheet) =>
        [...sheet.cssRules].flatMap((rule) => [
          rule.cssText,
          ...("cssRules" in rule
            ? [...(rule as CSSGroupingRule).cssRules].map((r) => r.cssText)
            : []),
        ]),
      ),
    );
    expect(rules.some((r) => r.includes("safe-area-inset-bottom") && r.includes("tabbar"))).toBe(
      true,
    );
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
  });

  test("reflows at 320px: no sideways scroll, every tab still a target", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const [, path] of SHELL_PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `no horizontal scroll on ${path}`).toBeLessThanOrEqual(0);
    }
    const tabs = await tabbar(page)
      .locator(".tab")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(tabs.every((h) => h >= 44)).toBe(true);
    const top = await page.getByRole("banner").boundingBox();
    expect(top?.height).toBeLessThanOrEqual(72);
  });
});

test.describe("one lime action per view", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  /** How many visible links and buttons are filled with the acid-lime action colour. */
  async function limeCount(page: Page): Promise<{ shell: boolean; total: number }> {
    return page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-acid-lime")
        .trim();
      document.body.append(probe);
      const lime = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const filled = [...document.querySelectorAll<HTMLElement>("a, button, summary")].filter(
        (el) => el.getClientRects().length > 0 && getComputedStyle(el).backgroundColor === lime,
      );
      const shellNew = document.querySelector<HTMLElement>(".shell-new");
      return { shell: shellNew !== null && filled.includes(shellNew), total: filled.length };
    });
  }

  const pageOwnsAction = (page: Page): Promise<number> =>
    page.locator("main .button-primary:visible").count();

  for (const [name, path] of [
    ["the Inbox", "/"],
    ["all notes", "/notes"],
    ["a folder", "/folders/folder-a-board"],
    ["the folders index", "/folders"],
    ["search", "/search"],
    ["settings", "/settings"],
    ["templates", "/settings/templates"],
    ["the new note form", "/meetings/new"],
    ["a review", "/meetings/meeting-a-published/review"],
    ["a meeting", "/meetings/meeting-a-published"],
  ] as const) {
    test(`${name}: the shell's New note is lime only when the page has no action of its own`, async ({
      page,
    }) => {
      await page.goto(path);
      const own = await pageOwnsAction(page);
      const { shell, total } = await limeCount(page);
      expect(shell, "shell New note is lime exactly when the page has no primary action").toBe(
        own === 0,
      );
      expect(total, "never more lime than the page's own actions plus none from the shell").toBe(
        own === 0 ? 1 : own,
      );
    });
  }

  test("home: the page's own New note is the default button, the shell has the lime one", async ({
    page,
  }) => {
    await page.goto("/");
    const own = page.getByRole("main").getByRole("link", { name: "New note" });
    await expect(own).toHaveAttribute("href", "/meetings/new");
    await expect(own).not.toHaveClass(/button-primary/);
    expect(await pageOwnsAction(page)).toBe(0);
    expect((await limeCount(page)).shell).toBe(true);
  });
});

test.describe("keyboard and focus order", () => {
  test("skip link first, then the shell, then the content, then (phone) the tab bar", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/search");
    const regions: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      regions.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return "none";
          if (el.classList.contains("skip-link")) return "skip";
          if (el.closest(".tabbar")) return "tabbar";
          if (el.closest("header")) return "header";
          if (el.closest("main")) return "main";
          if (el.closest("footer")) return "footer";
          return "other";
        }),
      );
    }
    expect(regions[0]).toBe("skip");
    // One trip through the page: Tab wraps round to the skip link when it runs out of controls.
    const wrap = regions.indexOf("skip", 1);
    const trip = wrap === -1 ? regions : regions.slice(0, wrap);
    const firstMain = trip.indexOf("main");
    expect(firstMain, "the content is reachable").toBeGreaterThan(0);
    expect(trip.slice(0, firstMain).filter((r) => r !== "skip" && r !== "header")).toEqual([]);
    expect(trip.slice(0, firstMain).filter((r) => r === "header").length).toBeGreaterThan(0);
    expect(trip).not.toContain("other");
    if (isPhone(page)) {
      expect(trip).toContain("tabbar");
      expect(trip.lastIndexOf("main")).toBeLessThan(trip.indexOf("tabbar"));
    } else {
      expect(trip).not.toContain("tabbar");
    }
  });

  test("the skip link still lands on the content", async ({ page }) => {
    await signIn(page);
    await page.goto("/folders");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("under reduced motion nothing in the shell animates", async ({ page }) => {
    await signIn(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const slow = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>("header *, .tabbar *")]
          .map((el) => getComputedStyle(el))
          .filter(
            (s) =>
              parseFloat(s.transitionDuration) > 0.001 || parseFloat(s.animationDuration) > 0.001,
          ).length,
    );
    expect(slow).toBe(0);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the shell navigates by plain links, folders included, and signs out", async ({ page }) => {
    await signIn(page);
    if (isPhone(page)) {
      await mainNav(page).getByRole("link", { name: "Search", exact: true }).click();
      await expect(page).toHaveURL(/\/search$/);
      await mainNav(page).getByRole("link", { name: "Folders", exact: true }).click();
      await expect(page).toHaveURL(/\/folders$/);
      await mainNav(page).locator("summary").click();
      await mainNav(page).getByRole("link", { name: "Settings", exact: true }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await mainNav(page).locator("summary").click();
      await mainNav(page).getByRole("button", { name: "Sign out" }).click();
    } else {
      await mainNav(page).getByRole("link", { name: "Search", exact: true }).click();
      await expect(page).toHaveURL(/\/search$/);
      await mainNav(page)
        .getByRole("link", { name: /^Board updates/ })
        .click();
      await expect(page).toHaveURL(/\/folders\/folder-a-board$/);
      await mainNav(page).getByRole("link", { name: "Settings", exact: true }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await page.getByRole("button", { name: "Sign out" }).click();
    }
    await expect(page).toHaveURL(/\/signed-out$/);
  });
});
