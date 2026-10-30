import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  advanceProcessing,
  createCapturingMeeting,
  createReviewMeeting,
  setChunkStates,
} from "../support/e2e-db";
import { createFreshOwner } from "../support/journey-db";

/**
 * Issue #66: the hand-off after Stop. The live note shows real counts, then one obvious action,
 * and opens the draft by itself only when the owner is not typing. The background worker is off in
 * e2e, so each test plays the worker (job rows and chunk rows) while the page is open and waits
 * for the page to say so; the first poll is due within 2-4 seconds. Waits are on text and URL.
 */

const PASSWORD = "willy-dev-password";
const WAIT = { timeout: 20_000 };
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function signIn(page: Page, email = "ada@example.test"): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
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

const region = (page: Page) => page.locator("#processing-progress");
const announce = (page: Page) => page.locator("#handoff-announce");
const openLink = (page: Page) => page.getByRole("link", { name: "Open the draft" });
const notesBox = (page: Page) => page.getByLabel("Your notes (saved as you type)");

/** A processing meeting with seven audio parts, two of them done. */
function processingWithParts(title: string): string {
  const id = createCapturingMeeting("owner-ada", "processing", title);
  advanceProcessing(id, { meeting: "processing", transcription: "running" });
  setChunkStates(id, [
    "purged",
    "purged",
    "uploaded",
    "uploaded",
    "uploaded",
    "uploaded",
    "uploaded",
  ]);
  return id;
}

/** The same meeting once its draft exists. */
function finish(id: string): void {
  setChunkStates(id, Array<"purged">(7).fill("purged"));
  advanceProcessing(id, { meeting: "review", transcription: "succeeded", summary: "succeeded" });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("after Stop: live counts, in place", () => {
  test("shows how many parts are done, follows the work, and says when the draft is being written", async ({
    page,
  }) => {
    const id = processingWithParts("Hand-off counts");
    await signIn(page);
    await page.goto(`/meetings/${id}`);

    // Server-rendered with the real counts: no JavaScript is needed to see them.
    await expect(region(page)).toContainText("Recording finished. Preparing the transcript.");
    await expect(region(page).locator('[data-field="transcribe"]')).toHaveText(
      "Transcribing: 2 of 7 parts",
    );
    await expect(region(page).locator('[data-field="draft"]')).toHaveText(
      "Writing the draft: Waiting for the transcript",
    );
    const bar = region(page).locator("progress");
    await expect(bar).toHaveAttribute("value", "2");
    await expect(bar).toHaveAttribute("max", "7");
    await expect(openLink(page)).toBeHidden();
    await noHorizontalScroll(page);
    await audit(page);

    // The page updates in place: a marker that a reload would remove.
    await page.evaluate(() => {
      (window as unknown as { sameDocument: boolean }).sameDocument = true;
    });
    setChunkStates(id, [
      "purged",
      "purged",
      "purged",
      "purged",
      "uploaded",
      "uploaded",
      "uploaded",
    ]);
    await expect(region(page).locator('[data-field="transcribe"]')).toHaveText(
      "Transcribing: 4 of 7 parts",
      WAIT,
    );
    await expect(bar).toHaveAttribute("value", "4");
    // Counts are not announced each time, only stages.
    await expect(announce(page)).toHaveText("");

    setChunkStates(id, Array<"purged">(7).fill("purged"));
    advanceProcessing(id, {
      meeting: "processing",
      transcription: "succeeded",
      summary: "running",
    });
    await expect(region(page).locator('[data-field="transcribe"]')).toHaveText(
      "Transcribing: Done, 7 parts",
      WAIT,
    );
    await expect(region(page).locator('[data-field="draft"]')).toHaveText(
      "Writing the draft: Running",
    );
    await expect(announce(page)).toHaveText("Transcript done. Writing the draft.");
    await expect(bar).toBeHidden();
    await audit(page);
    expect(
      await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument),
    ).toBe(true);
  });
});

test.describe("when the draft is ready", () => {
  test("opens by itself when the owner is not typing, after saying so", async ({ page }) => {
    const id = processingWithParts("Hand-off auto open");
    await signIn(page);
    await page.goto(`/meetings/${id}`);
    await expect(region(page).locator('[data-field="transcribe"]')).toHaveText(
      "Transcribing: 2 of 7 parts",
    );
    // Nothing is focused: the page never moves focus, and the owner is not in a text field.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");

    finish(id);
    await expect(announce(page)).toHaveText("Draft ready, opening it.", WAIT);
    await expect(announce(page)).toHaveAttribute("role", "status");
    await expect(page).toHaveURL(`/meetings/${id}/review`, WAIT);
    await expect(page.getByRole("heading", { level: 1, name: "Hand-off auto open" })).toBeVisible();
  });

  test("stays a single primary button while focus is in the rough notes, and never takes focus", async ({
    page,
  }) => {
    const id = processingWithParts("Hand-off typing");
    await signIn(page);
    await page.goto(`/meetings/${id}`);
    await notesBox(page).click();
    await expect(notesBox(page)).toBeFocused();

    finish(id);
    const link = openLink(page);
    await expect(link).toBeVisible(WAIT);
    await expect(link).toHaveAttribute("href", `/meetings/${id}/review`);
    await expect(link).toHaveClass(/button-primary/);
    await expect(link).toHaveClass(/handoff-reveal/); // the short fade, for people who allow motion
    await expect(announce(page)).toHaveText("Draft ready. Use the Open the draft button.");
    await expect(region(page).locator('[data-field="outcome"]')).toHaveText("Your draft is ready.");
    // One primary action in the view.
    await expect(page.locator(".button-primary:visible")).toHaveCount(1);
    await expect(page).toHaveTitle(/^Draft ready/);

    // Give an unwanted navigation its chance (announcement delay plus margin), then check the
    // owner is exactly where they were. There is no state to wait on for something not happening.
    await page.waitForTimeout(3_000);
    await expect(page).toHaveURL(`/meetings/${id}`);
    await expect(notesBox(page)).toBeFocused();
    await noHorizontalScroll(page);
    await audit(page);

    await link.click();
    await expect(page).toHaveURL(`/meetings/${id}/review`);
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("the button appears without the fade, and an idle owner is still taken to the draft", async ({
      page,
    }) => {
      const typing = processingWithParts("Hand-off reduced typing");
      await signIn(page);
      await page.goto(`/meetings/${typing}`);
      await notesBox(page).click();
      finish(typing);
      await expect(openLink(page)).toBeVisible(WAIT);
      await expect(openLink(page)).not.toHaveClass(/handoff-reveal/);

      // A page change is not an animation: an idle owner is still taken to the draft.
      const idle = processingWithParts("Hand-off reduced idle");
      await page.goto(`/meetings/${idle}`);
      finish(idle);
      await expect(page).toHaveURL(`/meetings/${idle}/review`, WAIT);
    });
  });

  test("stays a button while the rough notes have changes that are not saved, even if focus left", async ({
    page,
  }) => {
    const id = processingWithParts("Hand-off unsaved");
    await signIn(page);
    // The autosave cannot reach the server (offline), so the notes stay unsaved.
    await page.route("**/api/meetings/*/notes", (route) => route.abort("connectionfailed"));
    await page.goto(`/meetings/${id}`);
    await notesBox(page).fill("typed just before the draft came");
    await expect(page.locator("#notes-status")).toContainText("Not saved yet");
    await page.getByRole("heading", { level: 1 }).click();
    await expect(notesBox(page)).not.toBeFocused();

    finish(id);
    await expect(openLink(page)).toBeVisible(WAIT);
    await expect(announce(page)).toHaveText("Draft ready. Use the Open the draft button.");
    await page.waitForTimeout(3_000); // see the previous test
    await expect(page).toHaveURL(`/meetings/${id}`);
    await expect(notesBox(page)).toHaveValue("typed just before the draft came");
  });

  test("stays put when typing starts while the announcement is playing", async ({ page }) => {
    const id = processingWithParts("Hand-off late typing");
    await signIn(page);
    await page.goto(`/meetings/${id}`);
    // The owner clicks into the notes the instant the announcement is written (before the page
    // navigates): done in the page, in the same task as the text change, so it cannot lose a race.
    await page.evaluate(() => {
      const note = document.getElementById("handoff-announce");
      const box = document.getElementById("rough-notes");
      if (!note || !box) throw new Error("hand-off elements are missing");
      const watcher = new MutationObserver(() => {
        if (note.textContent === "Draft ready, opening it.") {
          box.focus();
          watcher.disconnect();
        }
      });
      watcher.observe(note, { childList: true, characterData: true, subtree: true });
    });
    finish(id);
    await expect(notesBox(page)).toBeFocused(WAIT);
    await expect(announce(page)).toHaveText("Draft ready. Use the Open the draft button.");
    await expect(openLink(page)).toBeVisible();
    await expect(page).toHaveURL(`/meetings/${id}`);
  });
});

test.describe("when processing fails", () => {
  test("morphs into one action to see what happened and retry, and never opens by itself", async ({
    page,
  }) => {
    const id = processingWithParts("Hand-off failure");
    await signIn(page);
    await page.goto(`/meetings/${id}`);
    setChunkStates(id, [
      "purged",
      "purged",
      "purged",
      "failed",
      "uploaded",
      "uploaded",
      "uploaded",
    ]);
    advanceProcessing(id, { meeting: "failed", transcription: "failed" });

    const retry = page.getByRole("link", { name: "See what happened and retry" });
    await expect(retry).toBeVisible(WAIT);
    await expect(retry).toHaveAttribute("href", `/meetings/${id}/review`);
    await expect(retry).toHaveClass(/button-primary/);
    await expect(region(page)).toContainText(
      "Processing did not finish. Your rough notes are kept.",
    );
    await expect(region(page).locator('[data-field="transcribe"]')).toHaveText(
      "Transcribing: Failed after 5 attempts (stt_unavailable)",
    );
    await expect(region(page).locator('[data-field="note"]')).toHaveText(
      "1 part could not be transcribed. 3 parts are kept.",
    );
    await expect(announce(page)).toContainText("Processing needs attention");
    await expect(page.locator(".button-primary:visible")).toHaveCount(1);
    await expect(openLink(page)).toBeHidden();
    await page.waitForTimeout(3_000); // it must not navigate; see the typing test
    await expect(page).toHaveURL(`/meetings/${id}`);
    await audit(page);

    await retry.click();
    await expect(page).toHaveURL(`/meetings/${id}/review`);
    await expect(page.getByRole("heading", { name: "Transcription did not finish" })).toBeVisible();
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("a reload shows the counts, then the button; nothing opens by itself", async ({ page }) => {
    const id = processingWithParts("Hand-off no JS");
    await signIn(page);
    await page.goto(`/meetings/${id}`);
    await expect(region(page).locator('[data-field="transcribe"]')).toHaveText(
      "Transcribing: 2 of 7 parts",
    );
    await expect(page.getByRole("link", { name: "Check again" })).toBeVisible();
    await expect(openLink(page)).toBeHidden();

    finish(id);
    await page.getByRole("link", { name: "Check again" }).click();
    await expect(openLink(page)).toBeVisible();
    await expect(openLink(page)).toHaveAttribute("href", `/meetings/${id}/review`);
    await page.waitForTimeout(2_000); // a reload must not navigate on its own
    await expect(page).toHaveURL(`/meetings/${id}`);
    await openLink(page).click();
    await expect(page).toHaveURL(`/meetings/${id}/review`);
  });
});

test.describe("owner scope", () => {
  test("another owner gets a plain 404 for the page and the counts, and sees no part of them", async ({
    page,
    browser,
  }) => {
    const id = processingWithParts("Hand-off private");
    const ben = createFreshOwner();
    const context = await browser.newContext();
    const other = await context.newPage();
    await signIn(other, ben.email);
    const response = await other.goto(`/meetings/${id}`);
    expect(response?.status()).toBe(404);
    expect(await other.content()).not.toContain("2 of 7 parts");
    const status = await other.request.get(`/api/meetings/${id}/status`);
    expect(status.status()).toBe(404);
    expect(await status.text()).not.toContain("transcribed");
    await context.close();

    // Positive control: the owner gets the counts, and the endpoint carries counts and codes only.
    await signIn(page);
    const own = await page.request.get(`/api/meetings/${id}/status`);
    expect(own.status()).toBe(200);
    expect(Object.keys((await own.json()) as object).sort()).toEqual([
      "chunks",
      "job",
      "meetingStatus",
      "regeneration",
      "summary",
    ]);
  });

  test("a meeting that already has its draft shows the button on load and does not open it", async ({
    page,
  }) => {
    const id = await createReviewMeeting("owner-ada");
    await signIn(page);
    await page.goto(`/meetings/${id}`);
    await expect(openLink(page)).toBeVisible();
    await page.waitForTimeout(2_500); // loading the page is not a hand-off: it must stay
    await expect(page).toHaveURL(`/meetings/${id}`);
  });
});
