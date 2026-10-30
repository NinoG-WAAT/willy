import { expect, test, type Page } from "@playwright/test";
import { createFolderWithNotes } from "../support/folder-fixtures";
import { createFreshOwner } from "../support/journey-db";

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

test.describe("browsing folders (read-only)", () => {
  test("home -> Folders -> a folder -> a note, by links alone", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Folders" }).click();
    await expect(page).toHaveURL(/\/folders$/);
    await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Folders" }),
    ).toHaveAttribute("aria-current", "page");

    const card = page.getByRole("listitem").filter({ hasText: "Board updates" });
    await expect(card).toContainText("1 note");
    await card.getByRole("link", { name: "Board updates" }).click();

    await expect(page).toHaveURL(/\/folders\/folder-a-board$/);
    await expect(page).toHaveTitle("Board updates - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Board updates" })).toBeVisible();
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Folders" })).toHaveAttribute("href", "/folders");
    await expect(crumbs.getByText("Board updates")).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("1 note", { exact: false }).first()).toBeVisible();
    await noHorizontalScroll(page);

    await page.getByRole("link", { name: /^Open note/ }).click();
    await expect(page).toHaveURL(/\/meetings\/meeting-a-published\/review$/);
  });

  test("the home screen shows folder chips that link to the folder; the filter stays", async ({
    page,
  }) => {
    await signIn(page, "ada@example.test");
    await page.goto("/");
    const chips = page.getByRole("navigation", { name: "Folders", exact: true });
    await chips.getByRole("link", { name: /^Board updates/ }).click();
    await expect(page).toHaveURL(/\/folders\/folder-a-board$/);
    await page.goto("/");
    await expect(page.getByLabel("Folder", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply" })).toBeVisible();
  });

  test("lists newest first, hides archived and deleting meetings, and counts only what it lists", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    const { folderId } = createFolderWithNotes(owner.id, "Customers", [
      { title: "Oldest call", startsAt: "2026-08-01T09:00:00.000Z" },
      { title: "Newest call", startsAt: "2026-10-01T09:00:00.000Z" },
      { title: "Middle call", startsAt: "2026-09-01T09:00:00.000Z" },
      { title: "Archived call", startsAt: "2026-09-15T09:00:00.000Z", status: "archived" },
      { title: "Secret deletion call", startsAt: "2026-09-20T09:00:00.000Z", status: "deleting" },
    ]);
    await signIn(page, owner.email);
    await page.goto("/folders");
    await expect(page.getByRole("listitem").filter({ hasText: "Customers" })).toContainText(
      "3 notes",
    );

    await page.goto(`/folders/${folderId}`);
    const titles = await page.locator(".rows .row-title").allTextContents();
    expect(titles.map((t) => t.trim())).toEqual(["Newest call", "Middle call", "Oldest call"]);
    await expect(page.getByText("Archived call")).toHaveCount(0);
    await expect(page.getByText("Secret deletion call")).toHaveCount(0);
    await expect(page.getByText("3 notes", { exact: false }).first()).toBeVisible();
  });

  test("an empty folder says what to do next", async ({ page }) => {
    const owner = createFreshOwner();
    const { folderId } = createFolderWithNotes(owner.id, "Hiring", []);
    await signIn(page, owner.email);
    await page.goto(`/folders/${folderId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Hiring" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing published here yet" })).toBeVisible();
    await expect(page.getByText("Publish a note to this folder from its review.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to your meetings" })).toHaveAttribute(
      "href",
      "/",
    );
    await noHorizontalScroll(page);
  });

  test("a long folder is paginated with previous and next links", async ({ page }) => {
    const owner = createFreshOwner();
    const specs = Array.from({ length: 27 }, (_, i) => ({
      title: `Note ${String(i + 1).padStart(2, "0")}`,
      startsAt: `2026-07-${String(i + 1).padStart(2, "0")}T09:00:00.000Z`,
    }));
    const { folderId } = createFolderWithNotes(owner.id, "Archive of notes", specs);
    await signIn(page, owner.email);
    await page.goto(`/folders/${folderId}`);
    await expect(page.locator(".rows > li")).toHaveCount(25);
    await expect(page.getByText("27 notes", { exact: false }).first()).toBeVisible();
    const pager = page.getByRole("navigation", { name: "Pages of notes" });
    await expect(pager).toContainText("Page 1 of 2");
    await expect(pager.getByRole("link", { name: /Previous/ })).toHaveCount(0);
    await pager.getByRole("link", { name: /Next/ }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator(".rows > li")).toHaveCount(2);
    await expect(page.getByRole("navigation", { name: "Pages of notes" })).toContainText(
      "Page 2 of 2",
    );
    await page.goto(`/folders/${folderId}?page=999`);
    await expect(page.locator(".rows > li")).toHaveCount(2);
    await page.goto(`/folders/${folderId}?page=abc`);
    await expect(page.locator(".rows > li")).toHaveCount(25);
  });

  test("another owner's folder and a guessed id are the same plain 404", async ({ page }) => {
    await signIn(page, "ada@example.test");
    const foreign = await page.goto("/folders/folder-b-board");
    expect(foreign?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
    await expect(page.getByText("Ben's confidential roadmap review")).toHaveCount(0);
    const foreignBody = await page.content();
    const guessed = await page.goto("/folders/does-not-exist");
    expect(guessed?.status()).toBe(404);
    expect(await page.content()).toBe(foreignBody);
  });

  test("another owner never sees this owner's folder", async ({ page }) => {
    await signIn(page, "ben@example.test");
    const response = await page.goto("/folders/folder-a-board");
    expect(response?.status()).toBe(404);
    await page.goto("/folders");
    await expect(page.getByText("Weekly sync with Grace")).toHaveCount(0);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Board updates" }).getByRole("link"),
    ).toHaveAttribute("href", "/folders/folder-b-board");
  });

  test("signed-out visitors are sent to sign-in", async ({ page }) => {
    await page.goto("/folders/folder-a-board");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Ffolders%2Ffolder-a-board$/);
  });

  test("the old settings URLs redirect to the new folder pages", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await page.goto("/settings/folders");
    await expect(page).toHaveURL(/\/folders$/);
    await page.goto("/settings/folders/folder-a-board/delete");
    await expect(page).toHaveURL(/\/folders\/folder-a-board\/delete$/);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("folders, a folder and a note open by plain links", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Folders" }).click();
    await page.getByRole("link", { name: "Board updates" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Board updates" })).toBeVisible();
    await page.getByRole("link", { name: /^Open note/ }).click();
    await expect(page).toHaveURL(/\/meetings\/meeting-a-published\/review$/);
  });
});
