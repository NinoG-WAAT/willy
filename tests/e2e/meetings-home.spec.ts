import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = "willy-dev-password";

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

function unique(label: string, info: TestInfo): string {
  return `${label} ${info.project.name} ${String(info.workerIndex)} ${String(Date.now())}`;
}

/** A meeting card by its title. */
function card(page: Page, title: string) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: title }) });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const DEMO = "Customer call with Grace (demo)";

test("signed-out visitors are sent to sign-in for the home and new-note pages", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/meetings/new");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fmeetings%2Fnew$/);
});

test.describe("meetings home (the Inbox, #72)", () => {
  test("shows calendar context, consent readiness and note status for the owner's meetings", async ({
    page,
  }) => {
    await signIn(page, "ada@example.test");
    await expect(page).toHaveTitle("Inbox - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    await noHorizontalScroll(page);

    const upcoming = card(page, "Intro call (not started)");
    await expect(upcoming).toContainText("Scheduled");
    await expect(upcoming).toContainText(
      "Your consent confirmation is still needed before capture",
    );
    await expect(upcoming.getByRole("link", { name: /Start note/ })).toHaveAttribute(
      "href",
      /^\/meetings\/[^/]+$/,
    );

    await expect(card(page, "Customer call (transcription failed)")).toContainText(
      "Needs attention",
    );
    await expect(card(page, "Investor update prep")).toContainText("Draft");

    // A published note lives in its folder and in All notes, not in the Inbox (status decides place).
    await expect(card(page, "Weekly sync with Grace")).toHaveCount(0);
    // Through the folder filter: Ada's other tests add meetings, so an unfiltered page may page.
    await page.goto("/notes?folder=folder-a-board");
    const published = card(page, "Weekly sync with Grace");
    await expect(published).toContainText("Published to Board updates");
    await expect(published).toContainText("You confirmed consent");
    await expect(published.getByRole("link", { name: /Open note/ })).toHaveAttribute(
      "href",
      /\/review$/,
    );
  });

  test("never lists archived or deleting meetings, or another owner's meetings", async ({
    page,
  }) => {
    await signIn(page, "ada@example.test");
    await expect(card(page, "Old kickoff")).toHaveCount(0);
    await expect(card(page, "Meeting being deleted")).toHaveCount(0);
    await expect(page.getByText("Ben's confidential roadmap review")).toHaveCount(0);

    // Archived notes are reachable through the All notes filter; one being deleted never is.
    await page.goto("/notes");
    await page
      .getByRole("navigation", { name: "Filter by status" })
      .getByRole("link", { name: "Archived" })
      .click();
    await expect(card(page, "Old kickoff")).toContainText("Archived");
    await expect(card(page, "Meeting being deleted")).toHaveCount(0);
    await page.goto("/notes");
    await expect(card(page, "Meeting being deleted")).toHaveCount(0);
  });

  test("the other owner sees only their own meeting", async ({ page }) => {
    await signIn(page, "ben@example.test");
    await page.goto("/notes");
    await expect(card(page, "Ben's confidential roadmap review")).toBeVisible();
    await expect(page.getByText("Weekly sync with Grace")).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByText("Weekly sync with Grace")).toHaveCount(0);
  });

  test("filters All notes by folder chip, and an empty folder or a guessed foreign folder id shows the empty state", async ({
    page,
  }, info) => {
    await signIn(page, "ada@example.test");
    await page.goto("/notes");
    await page
      .getByRole("navigation", { name: "Filter by folder" })
      .getByRole("link", { name: "Board updates" })
      .click();
    await expect(page).toHaveURL(/folder=folder-a-board/);
    await expect(card(page, "Weekly sync with Grace")).toBeVisible();
    await expect(card(page, "Intro call (not started)")).toHaveCount(0);

    const folder = unique("Empty folder", info);
    await page.goto("/folders");
    await page.getByLabel("Folder name", { exact: true }).fill(folder);
    await page.getByRole("button", { name: "Create folder" }).click();
    await page.goto("/notes");
    await page
      .getByRole("navigation", { name: "Filter by folder" })
      .getByRole("link", { name: folder })
      .click();
    await expect(page.getByRole("heading", { name: "No notes match" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" }).first()).toBeVisible();

    await page.goto("/notes?folder=folder-b-board");
    await expect(page.getByRole("heading", { name: "No notes match" })).toBeVisible();
    await expect(page.getByText("Ben's confidential roadmap review")).toHaveCount(0);
  });

  test("has a labelled search form and a clear New note action", async ({ page }) => {
    await signIn(page, "ada@example.test");
    const search = page.getByRole("search");
    await expect(search.getByLabel("Search your notes")).toBeVisible();
    await expect(search.getByRole("button", { name: "Search" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "New note" })).toHaveAttribute(
      "href",
      "/meetings/new",
    );
  });
});

test.describe("calendar import", () => {
  test("imports demo events once: repeating the import never duplicates a meeting", async ({
    page,
  }) => {
    await signIn(page, "ada@example.test");
    await page.getByRole("button", { name: "Import from calendar" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Imported/ })).toContainText(
      /Imported \d+ new meetings?\. \d+ events? (was|were) already in your list\./,
    );
    await expect(card(page, DEMO)).toHaveCount(1);
    await expect(card(page, DEMO)).toContainText("From your calendar");
    await expect(card(page, DEMO)).toContainText("1 attendee");

    await page.getByRole("button", { name: "Import from calendar" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Imported/ })).toContainText(
      "Imported 0 new meetings. 2 events were already in your list.",
    );
    await expect(card(page, DEMO)).toHaveCount(1);

    await page.reload();
    await expect(card(page, DEMO)).toHaveCount(1);
  });

  test("a calendar outage is explained, recoverable, and changes nothing", async ({ page }) => {
    await signIn(page, "ben@example.test");
    await page.getByRole("button", { name: "Import from calendar" }).click();
    await expect(page.getByRole("alert")).toContainText("Your calendar could not be reached");
    await expect(page.getByRole("alert")).toContainText("create a note manually");
    await expect(card(page, DEMO)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "New note" })).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("button", { name: "Import from calendar" }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("link", { name: "Import from ICS file" }),
    ).toBeVisible();
    await page.goto("/notes");
    await expect(card(page, "Ben's confidential roadmap review")).toBeVisible();
  });
});

test.describe("new note", () => {
  test("creates a note that appears under Upcoming, not started, with consent still needed", async ({
    page,
  }, info) => {
    const title = unique("Board prep", info);
    await signIn(page, "ada@example.test");
    await page.getByRole("main").getByRole("link", { name: "New note" }).click();
    await expect(page).toHaveTitle("New note - Willycrumbs");
    await noHorizontalScroll(page);

    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill("2030-05-14");
    await page.getByLabel("Start time").fill("09:00");
    await page.getByLabel("Time zone").selectOption("Europe/Paris");
    await page.getByLabel("Duration (minutes)").fill("45");
    await page.getByLabel("Agenda (optional)").fill("Roadmap\nHiring plan");
    await page.getByLabel("Attendees (optional)").fill("Grace Hopper <grace@example.com>\nAlan");
    await page.getByRole("button", { name: "Create note" }).click();

    await expect(page).toHaveURL(/\/\?notice=created$/);
    await expect(page.getByRole("status").filter({ hasText: "Note created" })).toBeVisible();
    const created = card(page, title);
    await expect(created).toBeVisible();
    await expect(created).toContainText("Scheduled");
    await expect(created).toContainText("2 attendees");
    await expect(created).toContainText("Your consent confirmation is still needed before capture");
    await expect(created.locator("time")).toContainText("14 May");
    await expect(created.locator("time")).toContainText("09:00");

    await page.reload();
    await expect(card(page, title)).toBeVisible();
  });

  test("shows every problem at once, keeps what was typed and creates nothing", async ({
    page,
  }) => {
    const attendees = "x <nope>";
    await signIn(page, "ada@example.test");
    await page.goto("/meetings/new");
    await page.getByLabel("Title").fill("   ");
    await page.getByLabel("Date").fill("2030-05-14");
    await page.getByLabel("Start time").fill("09:00");
    await page.getByLabel("Attendees (optional)").fill(attendees);
    await page.getByRole("button", { name: "Create note" }).click();

    const summary = page.getByRole("alert");
    await expect(summary).toContainText("Enter a title for the meeting.");
    await expect(summary).toContainText("is not a valid email address");
    await expect(page.getByLabel("Title")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Attendees (optional)")).toHaveValue(attendees);
    await expect(page.getByLabel("Date")).toHaveValue("2030-05-14");
  });

  test("works without JavaScript", async ({ browser }, info) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const title = unique("NoJS note", info);
    await signIn(page, "ada@example.test");
    await page.goto("/meetings/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill("2030-06-04");
    await page.getByLabel("Start time").fill("14:30");
    await page.getByRole("button", { name: "Create note" }).click();
    await expect(card(page, title)).toBeVisible();
    await context.close();
  });
});
