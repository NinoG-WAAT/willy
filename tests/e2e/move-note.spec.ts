import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  countAuditEvents,
  createReviewMeeting,
  removeEmptyFolder,
  reviewFolderName,
} from "../support/e2e-db";
import { createFolderWithNotes } from "../support/folder-fixtures";
import { createFreshOwner } from "../support/journey-db";

/**
 * Issue #76: move a published note to another folder from the review header, without reopening
 * it. Every test uses its own fresh owner, so no other spec's lists, counts or sidebar change.
 * Run at desktop and 390x844 (the two Playwright projects).
 */

const PASSWORD = "willy-dev-password";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const BEN_NOTE = "meeting-b-published";

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  return (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
}

async function audit(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    results.violations.map((v) => ({
      rule: v.id,
      impact: v.impact,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    })),
    `axe violations on ${page.url()}`,
  ).toEqual([]);
}

const header = (page: Page): Locator => page.locator("header.meeting-header");
const moveSummary = (page: Page): Locator =>
  header(page).locator("summary", { hasText: "Move to folder" });
const targetSelect = (page: Page): Locator => page.getByLabel("Move this note to");
const moveButton = (page: Page): Locator =>
  header(page).getByRole("button", { name: "Move", exact: true });
const folderChip = (page: Page): Locator => header(page).getByRole("link", { name: /^Folder:/ });

interface Setup {
  owner: { id: string; email: string };
  meetingId: string;
  fromName: string;
  other: { id: string; name: string };
}

/** A fresh owner with a draft in review and a second, empty folder; signed in, not yet published. */
async function draftWithTwoFolders(page: Page): Promise<Setup> {
  const owner = createFreshOwner();
  const meetingId = await createReviewMeeting(owner.id);
  const name = `Customers ${owner.id.slice(-6)}`;
  const { folderId } = createFolderWithNotes(owner.id, name, []);
  await signIn(page, owner.email);
  return {
    owner,
    meetingId,
    fromName: reviewFolderName(meetingId),
    other: { id: folderId, name },
  };
}

async function publishIntoFirstFolder(page: Page, s: Setup): Promise<void> {
  await page.goto(`/meetings/${s.meetingId}/review`);
  await page.getByLabel("Private folder").selectOption({ label: s.fromName });
  await page.getByLabel("I have reviewed this note and want to publish it.").check();
  await page.getByRole("button", { name: "Publish to folder" }).click();
  await expect(page.locator("#note-status")).toHaveText("Published");
}

async function folderNoteCount(page: Page, name: string): Promise<string> {
  await page.goto("/folders");
  const card = page.getByRole("main").getByRole("listitem").filter({ hasText: name });
  return (await card.innerText()).replace(/\s+/g, " ");
}

test.describe("move a published note", () => {
  test("from the review header: folder chip, folder views and counts follow, a refresh keeps it, one audit event", async ({
    page,
  }) => {
    const s = await draftWithTwoFolders(page);
    await publishIntoFirstFolder(page, s);
    await expect(folderChip(page)).toHaveText(`Folder: ${s.fromName}`);

    // The control sits in the header, closed until asked for, and is a default (not lime) button.
    await expect(targetSelect(page)).toBeHidden();
    await moveSummary(page).click();
    await expect(targetSelect(page)).toBeVisible();
    // The folder it is in is not offered as a target.
    await expect(targetSelect(page).locator("option")).toHaveText([s.other.name]);
    await moveButton(page).click();

    // Success: a status announcement naming the folder, the chip and the page state updated.
    await expect(
      page.getByRole("status").filter({ hasText: `Moved to ${s.other.name}.` }),
    ).toBeVisible();
    await expect(folderChip(page)).toHaveText(`Folder: ${s.other.name}`);
    await expect(folderChip(page)).toHaveAttribute("href", `/folders/${s.other.id}`);
    await expect(page.locator("#note-status")).toHaveText("Published");
    await expect(page.locator("#publish")).toContainText(s.other.name);
    // Focus returns to the control next to the chip it changed (fragment navigation).
    await expect(moveSummary(page)).toBeFocused();
    expect(countAuditEvents(s.meetingId, "note.moved")).toBe(1);

    // A refresh keeps the state (the notice code is gone from a plain reload of the page).
    await page.goto(`/meetings/${s.meetingId}/review`);
    await expect(folderChip(page)).toHaveText(`Folder: ${s.other.name}`);

    // Folder views and counts: the old folder lost the note, the new one has it.
    expect(await folderNoteCount(page, s.fromName)).toContain("0 notes");
    expect(await folderNoteCount(page, s.other.name)).toContain("1 note");
    await page.goto(`/folders/${s.other.id}`);
    await expect(page.getByRole("link", { name: /^Open note/ })).toHaveAttribute(
      "href",
      `/meetings/${s.meetingId}/review`,
    );
    await page.goto(`/folders/folder-${s.meetingId}`);
    await expect(page.getByText("Nothing published here yet")).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) >= 960) {
      const sidebar = page.getByRole("navigation", { name: "Main" });
      await expect(
        sidebar.getByRole("link", { name: new RegExp(`^${s.other.name}\\s+1 note$`) }),
      ).toBeVisible();
      await expect(
        sidebar.getByRole("link", { name: new RegExp(`^${s.fromName}\\s+0 notes$`) }),
      ).toBeVisible();
    }
  });

  test("moving it back works, and each real move is its own audit event", async ({ page }) => {
    const s = await draftWithTwoFolders(page);
    await publishIntoFirstFolder(page, s);
    await moveSummary(page).click();
    await targetSelect(page).selectOption({ label: s.other.name });
    await moveButton(page).click();
    await expect(
      page.getByRole("status").filter({ hasText: `Moved to ${s.other.name}.` }),
    ).toBeVisible();

    await moveSummary(page).click();
    await expect(targetSelect(page).locator("option")).toHaveText([s.fromName]);
    await targetSelect(page).selectOption({ label: s.fromName });
    await moveButton(page).click();
    await expect(folderChip(page)).toHaveText(`Folder: ${s.fromName}`);
    expect(countAuditEvents(s.meetingId, "note.moved")).toBe(2);
  });

  test("is not offered on a draft, and goes away again when the note is reopened", async ({
    page,
  }) => {
    const s = await draftWithTwoFolders(page);
    await page.goto(`/meetings/${s.meetingId}/review`);
    await expect(header(page)).toBeVisible();
    await expect(moveSummary(page)).toHaveCount(0);
    await publishIntoFirstFolder(page, s);
    await expect(moveSummary(page)).toBeVisible();
    // Reopen for editing: the control goes away again, the existing flow is unchanged.
    await page.getByRole("button", { name: "Reopen for editing" }).click();
    await expect(page.locator("#note-status")).toHaveText("Draft");
    await expect(moveSummary(page)).toHaveCount(0);
  });

  test("with no other folder it says so and offers to create one", async ({ page }) => {
    const owner = createFreshOwner();
    const meetingId = await createReviewMeeting(owner.id);
    await signIn(page, owner.email);
    await publishIntoFirstFolder(page, {
      owner,
      meetingId,
      fromName: reviewFolderName(meetingId),
      other: { id: "", name: "" },
    });
    await moveSummary(page).click();
    await expect(
      header(page).getByText("You have no other folder to move this note to."),
    ).toBeVisible();
    await expect(header(page).getByRole("link", { name: "Create a folder" })).toHaveAttribute(
      "href",
      "/folders",
    );
    await expect(moveButton(page)).toHaveCount(0);
    await audit(page);
  });

  test("a note reopened in another tab is refused with a clear error and never moves", async ({
    page,
  }) => {
    const s = await draftWithTwoFolders(page);
    await publishIntoFirstFolder(page, s);
    await moveSummary(page).click();
    await targetSelect(page).selectOption({ label: s.other.name });

    const second = await page.context().newPage();
    await second.goto(`/meetings/${s.meetingId}/review`);
    await second.getByRole("button", { name: "Reopen for editing" }).click();
    await expect(second.locator("#note-status")).toHaveText("Draft");
    await second.close();

    await moveButton(page).click();
    await expect(page.getByRole("alert")).toContainText("Only a published note can be moved");
    expect(countAuditEvents(s.meetingId, "note.moved")).toBe(0);
    await expect(page.locator("#note-status")).toHaveText("Draft");
    await expect(moveSummary(page)).toHaveCount(0);
    await audit(page);
  });

  test("a folder deleted in the meantime shows a field error and the form stays open", async ({
    page,
  }) => {
    const s = await draftWithTwoFolders(page);
    // A third folder keeps the form on the page once the chosen one is gone.
    createFolderWithNotes(s.owner.id, `Spare ${s.owner.id.slice(-6)}`, []);
    await publishIntoFirstFolder(page, s);
    await moveSummary(page).click();
    await targetSelect(page).selectOption({ label: s.other.name });
    removeEmptyFolder(s.other.id);

    await moveButton(page).click();
    await expect(page.getByRole("alert")).toContainText("not saved");
    await expect(header(page).locator(".field-error")).toHaveText(
      "That folder is not available. Choose one of your folders.",
    );
    await expect(targetSelect(page)).toBeVisible();
    await expect(targetSelect(page)).toHaveAttribute("aria-describedby", /move-folder-error/);
    await expect(folderChip(page)).toHaveText(`Folder: ${s.fromName}`);
    expect(countAuditEvents(s.meetingId, "note.moved")).toBe(0);
    await audit(page);
  });

  test("another owner's note and folder: 404 for the meeting, a field error for the folder, nothing moves", async ({
    page,
  }) => {
    const s = await draftWithTwoFolders(page);
    await publishIntoFirstFolder(page, s);
    const token = await page.locator("input[name=csrf_token]").first().getAttribute("value");
    const origin = new URL(page.url()).origin;
    const post = (path: string, form: Record<string, string>) =>
      page.request.post(path, {
        headers: { origin },
        form: { csrf_token: token ?? "", intent: "move_note", ...form },
        maxRedirects: 0,
      });

    // Ben's published note and a guessed id look exactly alike.
    expect((await post(`/meetings/${BEN_NOTE}/review`, { folder: s.other.id })).status()).toBe(404);
    expect((await post("/meetings/does-not-exist/review", { folder: s.other.id })).status()).toBe(
      404,
    );
    // Ben's folder is no folder of mine: the same answer as a guessed folder id.
    const foreign = await post(`/meetings/${s.meetingId}/review`, { folder: "folder-b-board" });
    const guessed = await post(`/meetings/${s.meetingId}/review`, { folder: "folder-guess" });
    expect(foreign.status()).toBe(422);
    expect(guessed.status()).toBe(422);
    expect(await foreign.text()).toContain("That folder is not available");
    expect(countAuditEvents(s.meetingId, "note.moved")).toBe(0);
    expect(countAuditEvents(BEN_NOTE, "note.moved")).toBe(0);
    // The foreign meeting's page is a 404 as well.
    expect((await page.goto(`/meetings/${BEN_NOTE}/review`))?.status()).toBe(404);
  });

  test("a move without the CSRF token is refused", async ({ page }) => {
    const s = await draftWithTwoFolders(page);
    await publishIntoFirstFolder(page, s);
    const response = await page.request.post(`/meetings/${s.meetingId}/review`, {
      headers: { origin: new URL(page.url()).origin },
      form: { intent: "move_note", folder: s.other.id },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    expect(countAuditEvents(s.meetingId, "note.moved")).toBe(0);
  });

  test("keyboard only: reach the control, open it, choose a folder and move", async ({ page }) => {
    const s = await draftWithTwoFolders(page);
    await publishIntoFirstFolder(page, s);
    await moveSummary(page).focus();
    await page.keyboard.press("Enter");
    await expect(targetSelect(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(targetSelect(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(moveButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: `Moved to ${s.other.name}.` }),
    ).toBeVisible();
  });

  test("axe: the header with the control closed, open, and after a move; targets are 44px", async ({
    page,
  }) => {
    const s = await draftWithTwoFolders(page);
    await publishIntoFirstFolder(page, s);
    await audit(page);
    await moveSummary(page).click();
    await audit(page);
    for (const control of [moveSummary(page), targetSelect(page), moveButton(page)]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await moveButton(page).click();
    await expect(page.getByRole("status").filter({ hasText: "Moved to" })).toBeVisible();
    await audit(page);
  });

  test("the move is still the page's only extra control: one lime action per view", async ({
    page,
  }) => {
    const s = await draftWithTwoFolders(page);
    await publishIntoFirstFolder(page, s);
    await moveSummary(page).click();
    const lime = await page.evaluate(() => {
      const found: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("a, button")) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (getComputedStyle(el).backgroundColor === "rgb(228, 242, 34)") {
          found.push(el.textContent.trim());
        }
      }
      return found;
    });
    // The Move button is a default button; the shell's New note is the one lime action.
    expect(lime).toEqual(["New note"]);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the move is a plain form: open, choose, submit, and the notice names the folder", async ({
    page,
  }) => {
    const s = await draftWithTwoFolders(page);
    await publishIntoFirstFolder(page, s);
    await moveSummary(page).click();
    await targetSelect(page).selectOption({ label: s.other.name });
    await moveButton(page).click();
    await expect(
      page.getByRole("status").filter({ hasText: `Moved to ${s.other.name}.` }),
    ).toBeVisible();
    await expect(folderChip(page)).toHaveText(`Folder: ${s.other.name}`);
    expect(countAuditEvents(s.meetingId, "note.moved")).toBe(1);
  });
});
