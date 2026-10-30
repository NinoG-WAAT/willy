import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  advanceDeletion,
  advanceProcessing,
  createCapturingMeeting,
  createDeletionInState,
  createReviewMeeting,
} from "../support/e2e-db";
import { createFolderWithNotes } from "../support/folder-fixtures";
import { installFakeMicrophone } from "../support/fake-microphone";
import { createFreshOwner } from "../support/journey-db";

/**
 * Accessibility pass (issue #21): every screen is scanned with axe-core at the desktop viewport
 * and at the 390x844 phone viewport (the two Playwright projects), and a few structural rules
 * axe cannot judge are asserted directly (hit targets, page title, landmarks, one h1).
 * Nothing here is excluded or disabled: a violation fails the test.
 */

const PASSWORD = "willy-dev-password";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function signIn(page: Page, email = "ada@example.test"): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
  expect(summary, `axe violations on ${page.url()}`).toEqual([]);
}

/** Interactive controls a finger must hit: >= 44 CSS px high (WCAG 2.2 AAA / platform guidance). */
async function expectHitTargets(page: Page): Promise<void> {
  const tooSmall = await page.evaluate(() => {
    const MIN = 44;
    const controls = document.querySelectorAll<HTMLElement>(
      "button, input:not([type=hidden]), select, textarea, summary, a.button, nav a, .row-actions a, a.brand, a.jump-link, a[data-source-from]",
    );
    const bad: string[] = [];
    for (const el of controls) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest("[hidden]")) {
        continue;
      }
      if (el.classList.contains("skip-link") || el.classList.contains("sr-only")) continue;
      // A checkbox or radio is hit through its label, which is the target a finger lands on.
      const type = el instanceof HTMLInputElement ? el.type : "";
      const box =
        type === "checkbox" || type === "radio"
          ? (el.closest("label, .check") ?? el).getBoundingClientRect()
          : el.getBoundingClientRect();
      if (box.height === 0 && box.width === 0) continue;
      if (box.height < MIN - 0.5) {
        const name = el.id || el.getAttribute("name") || el.textContent.trim().slice(0, 30) || "";
        bad.push(`${el.tagName.toLowerCase()}[${name}] ${String(Math.round(box.height))}px`);
      }
    }
    return bad;
  });
  expect(tooSmall, "controls shorter than 44px").toEqual([]);
}

async function expectStructure(page: Page): Promise<void> {
  expect((await page.title()).trim().length, "page has a useful title").toBeGreaterThan(
    " - Willycrumbs".length,
  );
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal page scroll").toBeLessThanOrEqual(0);
}

async function audit(page: Page): Promise<void> {
  await expectStructure(page);
  await expectNoViolations(page);
  await expectHitTargets(page);
}

test("the scanner is not vacuous: it flags an unlabeled input", async ({ page }) => {
  await page.setContent(
    `<!doctype html><html lang="en"><head><title>x</title></head><body><main><h1>t</h1><input type="text"></main></body></html>`,
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations.map((v) => v.id)).toContain("label");
});

test.describe("public pages", () => {
  for (const path of ["/sign-in", "/signed-out", "/session-expired"]) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await audit(page);
    });
  }

  test("sign-in with a wrong password shows an announced error", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("ada@example.test");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await audit(page);
  });

  test("404 page", async ({ page }) => {
    await signIn(page);
    const response = await page.goto("/meetings/does-not-exist");
    expect(response?.status()).toBe(404);
    await audit(page);
  });
});

test.describe("standalone failure pages", () => {
  // These are plain HTML strings built outside Astro (forbidden, too many requests, failure), so
  // they are checked as the browser receives them.
  test("403 request refused page is a usable standalone document", async ({ page }) => {
    await signIn(page);
    const refused = await page.request.post("/sign-out", {
      // Same origin but no CSRF token: refused by our own check, not by the framework's.
      headers: { origin: new URL(page.url()).origin },
      maxRedirects: 0,
    });
    expect(refused.status()).toBe(403);
    const html = await refused.text();
    await page.setContent(html);
    await expect(page.locator("meta[name=viewport]")).toHaveCount(1);
    await expect(page.getByRole("link", { name: /back to your meetings/i })).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("owner screens", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeMicrophone(page);
    await signIn(page);
  });

  test("meetings home", async ({ page }) => {
    await page.goto("/");
    await audit(page);
  });

  test("meetings home, calendar outage state", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, "ben@example.test");
    await page.goto("/");
    await audit(page);
    await context.close();
  });

  test("ICS import: form, refusal, preview and notice", async ({ page }) => {
    await page.goto("/meetings/import/ics");
    await audit(page);
    // Refusal state: an announced error next to the file field.
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await audit(page);
    // Preview state: events to tick, a series notice, a cancelled event without a checkbox.
    await page
      .getByLabel("Calendar file (.ics, up to 1 MB)")
      .setInputFiles("tests/fixtures/ics/outlook-week.ics");
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Preview" })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(5);
    await audit(page);
    // Success state: the home screen with the import notice.
    await page.getByRole("button", { name: "Import selected events" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "from the calendar file" }),
    ).toBeVisible();
    await audit(page);
  });

  test("ICS import: nothing importable", async ({ page }) => {
    await page.goto("/meetings/import/ics");
    const cancelledOnly = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:a11y-1",
      "STATUS:CANCELLED",
      "SUMMARY:Called off",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:a11y-2",
      "SUMMARY:No start",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    await page.getByLabel("Or paste the calendar text").fill(cancelledOnly);
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByText("Every event in this file was cancelled")).toBeVisible();
    await audit(page);
  });

  test("new note and its validation errors", async ({ page }) => {
    await page.goto("/meetings/new");
    await audit(page);
    // Browsers block empty required fields themselves; whitespace reaches the server's validation.
    await page.getByLabel("Title").fill("   ");
    await page.getByLabel("Date").fill("2030-05-14");
    await page.getByLabel("Start time").fill("09:00");
    await page.getByRole("button", { name: "Create note" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await audit(page);
  });

  test("live note before capture", async ({ page }) => {
    const id = createCapturingMeeting("owner-ada", "scheduled", "A11y scheduled");
    await page.goto(`/meetings/${id}`);
    await audit(page);
  });

  test("live note while capturing", async ({ page }) => {
    const id = createCapturingMeeting("owner-ada", "capturing", "A11y capturing");
    await page.goto(`/meetings/${id}`);
    await expect(page.locator("#rec-banner")).toBeVisible();
    await audit(page);
  });

  for (const status of ["failed", "processing"] as const) {
    test(`live note, ${status} state`, async ({ page }) => {
      const id = createCapturingMeeting("owner-ada", status, `A11y ${status}`);
      await page.goto(`/meetings/${id}`);
      await audit(page);
    });
  }

  test("review, fresh draft", async ({ page }) => {
    const id = await createReviewMeeting("owner-ada");
    await page.goto(`/meetings/${id}/review`);
    await audit(page);
  });

  // Job progress (#51): the live regions are scanned in the state the page loads with and again
  // after a live update has rewritten them.
  test("review while processing, before and after a live update", async ({ page }) => {
    const id = await createReviewMeeting("owner-ada");
    advanceProcessing(id, { meeting: "processing", transcription: "running", summary: "pending" });
    await page.goto(`/meetings/${id}/review`);
    const region = page.locator("#processing-progress");
    await expect(region).toContainText("Transcript: Running");
    await audit(page);
    advanceProcessing(id, { meeting: "failed", transcription: "failed" });
    await expect(region).toContainText("Processing did not finish", { timeout: 20_000 });
    await audit(page);
  });

  test("live note while processing, after a live update", async ({ page }) => {
    const id = createCapturingMeeting("owner-ada", "processing", "A11y progress");
    advanceProcessing(id, { meeting: "processing", transcription: "running" });
    await page.goto(`/meetings/${id}`);
    await audit(page);
    // Focus in the notes keeps the hand-off from opening the draft (#66); handoff.spec scans
    // the other hand-off states.
    await page.getByLabel("Your notes (saved as you type)").click();
    advanceProcessing(id, { meeting: "review", transcription: "succeeded", summary: "succeeded" });
    await expect(page.getByText("Your draft is ready")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Open the draft" })).toBeVisible();
    await audit(page);
  });

  test("live note, ready for review (link to the draft)", async ({ page }) => {
    const id = await createReviewMeeting("owner-ada");
    await page.goto(`/meetings/${id}`);
    await expect(page.getByRole("link", { name: "Open the draft" })).toBeVisible();
    await audit(page);
  });

  test("home with a processing meeting, after a live update", async ({ browser }) => {
    // A fresh owner: only the first few processing meetings on a page are watched.
    const owner = createFreshOwner();
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, owner.email);
    const id = createCapturingMeeting(owner.id, "processing", "A11y progress card");
    advanceProcessing(id, { meeting: "processing", transcription: "running" });
    await page.goto("/");
    await audit(page);
    advanceProcessing(id, { meeting: "failed", transcription: "failed" });
    await expect(page.locator(`[data-meeting-id="${id}"]`)).toContainText("Needs attention", {
      timeout: 20_000,
    });
    await audit(page);
    await context.close();
  });

  test("settings with a running deletion, before and after it fails", async ({ browser }) => {
    const owner = createFreshOwner();
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, owner.email);
    const id = createDeletionInState(owner.id, "pending");
    await page.goto("/settings");
    await audit(page);
    advanceDeletion(id, "failed");
    const row = page.locator(`[data-deletion-id="${id}"]`);
    await expect(row).toContainText("Failed", { timeout: 20_000 });
    await audit(page);
    await context.close();
  });

  // Seeded states of owner Ada (seeds/seed.ts) and read-only screens. One test per screen keeps
  // each scan well inside the timeout when the whole suite runs in parallel.
  const screens: [string, string][] = [
    ["review, published note", "/meetings/meeting-a-published/review"],
    ["review, overdue action item", "/meetings/meeting-a-overdue/review"],
    ["meeting, failed capture", "/meetings/meeting-a-failed"],
    ["meeting, empty", "/meetings/meeting-a-empty"],
    ["meeting, archived", "/meetings/meeting-a-archived"],
    ["search, no query", "/search"],
    ["search, results", "/search?q=roadmap"],
    ["search, no results", "/search?q=zzzznothingmatches"],
    ["folders", "/folders"],
    ["folder view", "/folders/folder-a-board"],
    ["folder view, page past the end", "/folders/folder-a-board?page=99"],
    ["templates", "/settings/templates"],
    ["new template", "/settings/templates/new"],
    ["edit template", "/settings/templates/template-a-weekly"],
    ["settings", "/settings"],
    ["delete meeting confirmation", "/meetings/meeting-a-published/delete"],
    ["delete folder confirmation", "/folders/folder-a-board/delete"],
    ["delete template confirmation", "/settings/templates/template-a-weekly/delete"],
  ];
  for (const [name, path] of screens) {
    test(name, async ({ page }) => {
      await page.goto(path);
      await audit(page);
    });
  }

  test("folder view: empty folder, long folder and another owner's folder", async ({ browser }) => {
    const owner = createFreshOwner();
    const empty = createFolderWithNotes(owner.id, "Hiring", []);
    const long = createFolderWithNotes(
      owner.id,
      "Archive of notes",
      Array.from({ length: 27 }, (_, i) => ({
        title: `Note ${String(i + 1)}`,
        startsAt: `2026-07-${String(i + 1).padStart(2, "0")}T09:00:00.000Z`,
      })),
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, owner.email);
    await page.goto(`/folders/${empty.folderId}`);
    await audit(page);
    await page.goto(`/folders/${long.folderId}`);
    await audit(page);
    expect((await page.goto("/folders/folder-a-board"))?.status()).toBe(404);
    await audit(page);
    await page.goto("/");
    await audit(page);
    await context.close();
  });

  // The app shell (#70): every scan above already includes it. These are its own states.
  test("shell: the More menu of the phone tab bar, open", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) >= 600, "the tab bar is a phone layout");
    await page.goto("/settings");
    await page.locator(".tabbar summary").click();
    await expect(page.locator(".tabbar").getByRole("button", { name: "Sign out" })).toBeVisible();
    await audit(page);
  });

  test("shell: no folders, and more folders than the sidebar lists", async ({ browser }) => {
    const none = createFreshOwner();
    const many = createFreshOwner();
    for (let i = 1; i <= 10; i += 1) {
      createFolderWithNotes(many.id, `Folder ${String(i).padStart(2, "0")}`, []);
    }
    for (const owner of [none, many]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, owner.email);
      await page.goto("/");
      await audit(page);
      await context.close();
    }
  });

  test("template form validation errors", async ({ page }) => {
    await page.goto("/settings/templates/new");
    await page.getByLabel("Template name").fill("   ");
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await audit(page);
  });
});
