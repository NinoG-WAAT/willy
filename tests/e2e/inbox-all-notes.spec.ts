import { expect, test, type Locator, type Page } from "@playwright/test";
import { createFreshOwner } from "../support/journey-db";
import { createFolder, createNotes } from "../support/notes-fixtures";

/**
 * UX 2b (#72): status decides place. The Inbox (`/`) lists what needs the owner in sections;
 * All notes (`/notes`) lists every non-deleted meeting with status and folder filters. Each test
 * owns a fresh owner, so parallel tests never see each other's meetings. Both Playwright
 * projects run it (desktop and 390x844).
 */

const PASSWORD = "willy-dev-password";

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const section = (page: Page, name: string): Locator => page.getByRole("region", { name });

/** A card by its title, anywhere on the page or inside one section (`scope`). */
const card = (page: Page, title: string, scope: Page | Locator = page): Locator =>
  scope.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: title }) });

/** The card titles of the page's list, in the order shown. */
async function titles(page: Page): Promise<string[]> {
  const all = await page.locator(".rows .row-title").allTextContents();
  return all.map((t) => t.trim());
}

const FUTURE = "2031-05-14T09:00:00.000Z";
const FUTURE_END = "2031-05-14T09:30:00.000Z";
const PAST = "2020-01-10T09:00:00.000Z";
const PAST_END = "2020-01-10T09:30:00.000Z";

test("signed-out visitors are sent to sign-in for All notes", async ({ page }) => {
  await page.goto("/notes");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fnotes$/);
});

test.describe("Inbox", () => {
  test("is the home page, with a section and a next step for every empty state", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    await signIn(page, owner.email);
    await page.goto("/");
    await expect(page).toHaveTitle("Inbox - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    await noHorizontalScroll(page);

    await expect(section(page, "In progress")).toContainText(
      "Nothing is recording or being processed.",
    );
    await expect(
      section(page, "In progress").getByRole("link", { name: "Go to upcoming notes" }),
    ).toHaveAttribute("href", "#upcoming-heading");
    await expect(section(page, "Upcoming")).toContainText("Nothing scheduled.");
    await expect(
      section(page, "Upcoming").getByRole("link", { name: "Create a note" }),
    ).toHaveAttribute("href", "/meetings/new");
    await expect(
      section(page, "Upcoming").getByRole("link", { name: "Import a calendar file" }),
    ).toHaveAttribute("href", "/meetings/import/ics");
    await expect(section(page, "Drafts to review")).toContainText("No draft is waiting.");
    await expect(
      section(page, "Drafts to review").getByRole("link", { name: "Browse all notes" }),
    ).toHaveAttribute("href", "/notes");
    await expect(page.getByRole("heading", { name: "Past and not started" })).toHaveCount(0);
  });

  test("status decides place: each meeting is in its section, and finished or hidden ones are not", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    const folderId = createFolder(owner.id, "Customers");
    createNotes(owner.id, [
      { title: "Soon call", status: "scheduled", startsAt: FUTURE, endsAt: FUTURE_END },
      { title: "Missed call", status: "scheduled", startsAt: PAST, endsAt: PAST_END },
      { title: "Live call", status: "capturing", startsAt: "2026-10-01T09:00:00.000Z" },
      { title: "Paused call", status: "paused", startsAt: "2026-10-02T09:00:00.000Z" },
      { title: "Crunching call", status: "processing", startsAt: "2026-10-03T09:00:00.000Z" },
      { title: "Broken call", status: "failed", startsAt: "2026-10-04T09:00:00.000Z" },
      { title: "Draft call", status: "review", startsAt: "2026-10-05T09:00:00.000Z" },
      {
        title: "Done call",
        status: "published",
        startsAt: "2026-10-06T09:00:00.000Z",
        folderId,
      },
      { title: "Shelved call", status: "archived", startsAt: "2026-10-07T09:00:00.000Z" },
      { title: "Vanishing call", status: "deleting", startsAt: "2026-10-08T09:00:00.000Z" },
    ]);
    await signIn(page, owner.email);
    await page.goto("/");

    const progress = section(page, "In progress");
    for (const t of ["Live call", "Paused call", "Crunching call", "Broken call"]) {
      await expect(card(page, t, progress)).toBeVisible();
    }
    await expect(card(page, "Broken call", progress)).toContainText("Needs attention");
    await expect(card(page, "Soon call", section(page, "Upcoming"))).toContainText("Not started");
    const drafts = section(page, "Drafts to review");
    await expect(card(page, "Draft call", drafts)).toContainText("Draft ready for review");
    await expect(
      card(page, "Draft call", drafts).getByRole("link", { name: /Review note/ }),
    ).toHaveAttribute("href", /\/review$/);
    await expect(card(page, "Missed call", section(page, "Past and not started"))).toBeVisible();

    // Finished and hidden notes are not here: published ones live in the folder.
    for (const t of ["Done call", "Shelved call", "Vanishing call"]) {
      await expect(page.getByText(t)).toHaveCount(0);
    }
    // The newest running work comes first, the soonest meeting first.
    const progressTitles = await progress.locator(".row-title").allTextContents();
    expect(progressTitles.map((x) => x.trim())).toEqual([
      "Broken call",
      "Crunching call",
      "Paused call",
      "Live call",
    ]);

    // Sections appear in one fixed order.
    const headings = await page.locator("main h2").allTextContents();
    expect(headings.map((h) => h.trim())).toEqual([
      "In progress",
      "Upcoming",
      "Drafts to review",
      "Past and not started",
    ]);
    await noHorizontalScroll(page);
  });

  test("the home folder dropdown, Apply button and archived checkbox are gone; the entry points stay", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    createFolder(owner.id, "Customers");
    await signIn(page, owner.email);
    await page.goto("/");
    const main = page.getByRole("main");
    await expect(main.getByLabel("Folder", { exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Apply" })).toHaveCount(0);
    await expect(main.getByLabel("Show archived")).toHaveCount(0);
    await expect(main.getByRole("link", { name: "New note" })).toHaveAttribute(
      "href",
      "/meetings/new",
    );
    await expect(main.getByRole("button", { name: "Import from calendar" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Import from ICS file" })).toHaveAttribute(
      "href",
      "/meetings/import/ics",
    );
    await expect(main.getByRole("search").getByLabel("Search your notes")).toBeVisible();
  });

  test("keeps exactly one lime action, the shell's New note", async ({ page }) => {
    const owner = createFreshOwner();
    await signIn(page, owner.email);
    await page.goto("/");
    await expect(page.locator("main .button-primary")).toHaveCount(0);
    const lime = await page
      .getByRole("banner")
      .getByRole("link", { name: "New note" })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const ghost = await page
      .getByRole("main")
      .getByRole("link", { name: "New note" })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(lime).not.toBe(ghost);
  });

  test("folder chips link to the folders", async ({ page }) => {
    const owner = createFreshOwner();
    const folderId = createFolder(owner.id, "Customers");
    await signIn(page, owner.email);
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Folders", exact: true })
      .getByRole("link", { name: /^Customers/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/folders/${folderId}$`));
  });

  test("another owner's notes never show, and the other owner sees only their own", async ({
    browser,
  }) => {
    const ada = createFreshOwner();
    const ben = createFreshOwner();
    createNotes(ada.id, [
      { title: "Ada private plan", status: "review", startsAt: "2026-10-05T09:00:00.000Z" },
    ]);
    createNotes(ben.id, [
      { title: "Ben private plan", status: "review", startsAt: "2026-10-05T09:00:00.000Z" },
    ]);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, ben.email);
    await page.goto("/");
    await expect(card(page, "Ben private plan")).toBeVisible();
    await expect(page.getByText("Ada private plan")).toHaveCount(0);
    await context.close();
  });

  test("works without JavaScript", async ({ browser }) => {
    const owner = createFreshOwner();
    createNotes(owner.id, [
      { title: "Plain draft", status: "review", startsAt: "2026-10-05T09:00:00.000Z" },
    ]);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await signIn(page, owner.email);
    await page.goto("/");
    await expect(card(page, "Plain draft", section(page, "Drafts to review"))).toBeVisible();
    await page.getByRole("link", { name: "Import from ICS file" }).click();
    await expect(page).toHaveURL(/\/meetings\/import\/ics$/);
    await context.close();
  });

  test("a long section is cut and says how many there are, linking to All notes", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    createNotes(
      owner.id,
      Array.from({ length: 52 }, (_, i) => ({
        title: `Draft ${String(i + 1).padStart(2, "0")}`,
        status: "review" as const,
        startsAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T${String(8 + Math.floor(i / 28)).padStart(2, "0")}:00:00.000Z`,
      })),
    );
    await signIn(page, owner.email);
    await page.goto("/");
    const drafts = section(page, "Drafts to review");
    await expect(drafts.locator(".rows > li")).toHaveCount(50);
    await expect(drafts).toContainText("Showing 50 of 52.");
    await drafts.getByRole("link", { name: "See all drafts" }).click();
    await expect(page).toHaveURL(/\/notes\?status=draft$/);
    await expect(page.getByRole("main")).toContainText("52 notes");
  });
});

test.describe("All notes", () => {
  test("lists every non-deleted meeting newest first, archived included, deleting never", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    createNotes(owner.id, [
      { title: "Oldest", status: "published", startsAt: "2026-08-01T09:00:00.000Z" },
      { title: "Newest", status: "scheduled", startsAt: FUTURE, endsAt: FUTURE_END },
      { title: "Middle", status: "review", startsAt: "2026-09-01T09:00:00.000Z" },
      { title: "Shelved", status: "archived", startsAt: "2026-07-01T09:00:00.000Z" },
      { title: "Secret deletion", status: "deleting", startsAt: "2026-09-20T09:00:00.000Z" },
    ]);
    await signIn(page, owner.email);
    await page.goto("/notes");
    await expect(page).toHaveTitle("All notes - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "All notes" })).toBeVisible();
    expect(await titles(page)).toEqual(["Newest", "Middle", "Oldest", "Shelved"]);
    await expect(page.getByText("Secret deletion")).toHaveCount(0);
    await expect(page.getByRole("main")).toContainText("4 notes");
    await expect(card(page, "Shelved")).toContainText("Archived");
    await noHorizontalScroll(page);
  });

  test("filters by status with links: Draft, Published and Archived, and marks the choice", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    createNotes(owner.id, [
      { title: "A draft", status: "review", startsAt: "2026-09-01T09:00:00.000Z" },
      { title: "A published", status: "published", startsAt: "2026-09-02T09:00:00.000Z" },
      { title: "An archived", status: "archived", startsAt: "2026-09-03T09:00:00.000Z" },
      { title: "A scheduled", status: "scheduled", startsAt: FUTURE, endsAt: FUTURE_END },
    ]);
    await signIn(page, owner.email);
    await page.goto("/notes");
    const status = page.getByRole("navigation", { name: "Filter by status" });
    await expect(status.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "true");

    await status.getByRole("link", { name: "Draft" }).click();
    await expect(page).toHaveURL(/\/notes\?status=draft$/);
    expect(await titles(page)).toEqual(["A draft"]);
    await expect(status.getByRole("link", { name: "Draft" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(status.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");

    await status.getByRole("link", { name: "Published" }).click();
    expect(await titles(page)).toEqual(["A published"]);
    await status.getByRole("link", { name: "Archived" }).click();
    expect(await titles(page)).toEqual(["An archived"]);
    await status.getByRole("link", { name: "All" }).click();
    await expect(page).toHaveURL(/\/notes$/);
    expect(await titles(page)).toHaveLength(4);
  });

  test("the current filter differs from the others by more than colour", async ({ page }) => {
    const owner = createFreshOwner();
    await signIn(page, owner.email);
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/notes?status=draft");
    const status = page.getByRole("navigation", { name: "Filter by status" });
    const cue = (name: string): Promise<string> =>
      status.getByRole("link", { name }).evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.fontWeight, s.borderTopWidth, getComputedStyle(el, "::before").content].join("|");
      });
    expect(await cue("Draft")).not.toBe(await cue("Published"));
  });

  test("folder chips filter, keep the status, and open the folder; a foreign folder id is empty", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    const customers = createFolder(owner.id, "Customers");
    const hiring = createFolder(owner.id, "Hiring");
    createNotes(owner.id, [
      {
        title: "Customer sync",
        status: "published",
        startsAt: "2026-09-02T09:00:00.000Z",
        folderId: customers,
      },
      {
        title: "Hiring sync",
        status: "published",
        startsAt: "2026-09-03T09:00:00.000Z",
        folderId: hiring,
      },
      { title: "Loose draft", status: "review", startsAt: "2026-09-04T09:00:00.000Z" },
    ]);
    await signIn(page, owner.email);
    await page.goto("/notes");
    const chips = page.getByRole("navigation", { name: "Filter by folder" });
    await expect(chips.getByRole("link", { name: "All folders" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await chips.getByRole("link", { name: "Customers" }).click();
    await expect(page).toHaveURL(new RegExp(`/notes\\?folder=${customers}$`));
    expect(await titles(page)).toEqual(["Customer sync"]);
    await expect(chips.getByRole("link", { name: "Customers" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    // The status choice keeps the folder, and the folder choice keeps the status.
    await page
      .getByRole("navigation", { name: "Filter by status" })
      .getByRole("link", { name: "Draft" })
      .click();
    await expect(page).toHaveURL(new RegExp(`status=draft&folder=${customers}$`));
    await expect(page.getByRole("heading", { name: "No notes match" })).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/notes$/);

    await page.goto(`/notes?folder=${customers}`);
    await page.getByRole("link", { name: "Open the folder" }).click();
    await expect(page).toHaveURL(new RegExp(`/folders/${customers}$`));

    await page.goto("/notes?folder=folder-b-board");
    await expect(page.getByRole("heading", { name: "No notes match" })).toBeVisible();
    await expect(page.getByText("Ben's confidential roadmap review")).toHaveCount(0);
  });

  test("an empty account says what to do next; a hostile filter value is just All", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    await signIn(page, owner.email);
    await page.goto("/notes");
    await expect(page.getByRole("heading", { name: "No notes yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create a note" })).toHaveAttribute(
      "href",
      "/meetings/new",
    );
    const response = await page.goto("/notes?status=%27%3B%20DROP%20TABLE&page=-5&folder=%00");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "All notes" })).toBeVisible();
  });

  test("a long list is paginated with previous and next links that keep the filter", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    createNotes(
      owner.id,
      Array.from({ length: 27 }, (_, i) => ({
        title: `Note ${String(i + 1).padStart(2, "0")}`,
        status: "review" as const,
        startsAt: `2026-07-${String(i + 1).padStart(2, "0")}T09:00:00.000Z`,
      })),
    );
    await signIn(page, owner.email);
    await page.goto("/notes?status=draft");
    await expect(page.locator(".rows > li")).toHaveCount(25);
    await expect(page.getByRole("main")).toContainText("27 notes");
    const pager = page.getByRole("navigation", { name: "Pages of notes" });
    await expect(pager).toContainText("Page 1 of 2");
    await expect(pager.getByRole("link", { name: /Previous/ })).toHaveCount(0);
    await pager.getByRole("link", { name: /Next/ }).click();
    await expect(page).toHaveURL(/\/notes\?status=draft&page=2$/);
    await expect(page.locator(".rows > li")).toHaveCount(2);
    await expect(pager).toContainText("Page 2 of 2");
    await pager.getByRole("link", { name: /Previous/ }).click();
    await expect(page).toHaveURL(/\/notes\?status=draft$/);
    await page.goto("/notes?status=draft&page=999");
    await expect(page.locator(".rows > li")).toHaveCount(2);
    await page.goto("/notes?page=abc");
    await expect(page.locator(".rows > li")).toHaveCount(25);
  });

  test("the cards are the same ones the folder view shows", async ({ page }) => {
    const owner = createFreshOwner();
    const folderId = createFolder(owner.id, "Customers");
    createNotes(owner.id, [
      { title: "Shared card", status: "published", startsAt: "2026-09-02T09:00:00.000Z", folderId },
    ]);
    await signIn(page, owner.email);
    await page.goto("/notes");
    const inAll = await card(page, "Shared card").innerHTML();
    await page.goto(`/folders/${folderId}`);
    const inFolder = await card(page, "Shared card").innerHTML();
    expect(inAll).toBe(inFolder);
  });

  test("another owner's notes never show, and a guessed folder id of theirs matches nothing", async ({
    browser,
  }) => {
    const ada = createFreshOwner();
    const ben = createFreshOwner();
    const benFolder = createFolder(ben.id, "Bens folder");
    createNotes(ada.id, [
      { title: "Ada private plan", status: "review", startsAt: "2026-10-05T09:00:00.000Z" },
    ]);
    createNotes(ben.id, [
      {
        title: "Ben private plan",
        status: "published",
        startsAt: "2026-10-05T09:00:00.000Z",
        folderId: benFolder,
      },
    ]);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, ada.email);
    await page.goto("/notes");
    await expect(card(page, "Ada private plan")).toBeVisible();
    await expect(page.getByText("Ben private plan")).toHaveCount(0);
    await expect(page.getByText("Bens folder")).toHaveCount(0);
    await page.goto(`/notes?folder=${benFolder}`);
    await expect(page.getByRole("heading", { name: "No notes match" })).toBeVisible();
    await expect(page.getByText("Ben private plan")).toHaveCount(0);
    await context.close();
  });

  test("works without JavaScript: filters and pages are plain links", async ({ browser }) => {
    const owner = createFreshOwner();
    createNotes(owner.id, [
      { title: "Plain draft", status: "review", startsAt: "2026-10-05T09:00:00.000Z" },
      { title: "Plain published", status: "published", startsAt: "2026-10-06T09:00:00.000Z" },
    ]);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await signIn(page, owner.email);
    await page.goto("/notes");
    await page
      .getByRole("navigation", { name: "Filter by status" })
      .getByRole("link", { name: "Published" })
      .click();
    expect(await titles(page)).toEqual(["Plain published"]);
    await context.close();
  });
});
