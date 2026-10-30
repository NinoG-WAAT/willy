import { expect, test, type Page } from "@playwright/test";
import {
  advanceDeletion,
  advanceProcessing,
  createCapturingMeeting,
  createDeletionInState,
  createReviewMeeting,
} from "../support/e2e-db";
import { createFreshOwner } from "../support/journey-db";

/**
 * Issue #51: job progress is announced as it changes. The background worker is off in e2e, so
 * each test plays the worker by writing the new job state into the database while the page is
 * open, then waits for the page to say so (the first poll is due within 2-4 seconds). Nothing
 * here sleeps: every wait is on text in a live region.
 */

const PASSWORD = "willy-dev-password";
const WAIT = { timeout: 20_000 };

async function signIn(page: Page, email = "ada@example.test"): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  return (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
}

test.describe("status endpoints", () => {
  test("the deletions status endpoint needs a session", async ({ request }) => {
    const res = await request.get("/api/deletions/status", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
  });

  test("it lists the signed-in owner's deletions with state only, never another owner's", async ({
    page,
    browser,
  }) => {
    const adas = createDeletionInState("owner-ada", "retrying");
    await signIn(page);
    const own = await page.request.get("/api/deletions/status");
    expect(own.status()).toBe(200);
    expect(own.headers()["cache-control"]).toBe("no-store");
    const body = (await own.json()) as { deletions: { meetingId: string }[] };
    expect(body.deletions.find((d) => d.meetingId === adas)).toEqual({
      meetingId: adas,
      status: "retrying",
      attempts: 2,
      maxAttempts: 5,
      nextRunAt: expect.stringMatching(/Z$/) as unknown,
      lastErrorCode: "storage_unavailable",
    });
    expect(JSON.stringify(body)).not.toContain("Hidden meeting");

    // A different owner sees none of Ada's rows, and there is no id in the URL to guess.
    const ben = createFreshOwner();
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signIn(otherPage, ben.email);
    const theirs = (await (await otherPage.request.get("/api/deletions/status")).json()) as {
      deletions: unknown[];
    };
    expect(theirs.deletions).toEqual([]);
    await other.close();
  });
});

test.describe("review screen, while the transcript is prepared", () => {
  test("the lines update in a live region and say when the draft is ready", async ({ page }) => {
    const id = await createReviewMeeting("owner-ada");
    advanceProcessing(id, { meeting: "processing", transcription: "running", summary: "pending" });
    await signIn(page);
    await page.goto(`/meetings/${id}/review`);

    const region = page.getByRole("status").filter({ hasText: "Transcript:" });
    await expect(region).toContainText("Transcript: Running");
    await expect(region).toContainText("Summary: Waiting to start");
    await expect(region).toHaveAttribute("aria-live", "polite");

    advanceProcessing(id, { meeting: "review", transcription: "succeeded", summary: "succeeded" });
    await expect(region).toContainText("Transcript: Done", WAIT);
    await expect(region).toContainText("Summary: Done");
    await expect(region).toContainText("Your draft is ready");
    await expect(page.locator("#note-status")).toHaveText("Draft: not published");
    // The no-JS way to the same place is still on the page and still works.
    await region.locator("xpath=..").getByRole("link", { name: "Check again" }).click();
    await expect(page.getByRole("heading", { name: "Summary", level: 2 })).toBeVisible();
  });

  test("a failed transcription is announced with its reason code and a way forward", async ({
    page,
  }) => {
    const id = await createReviewMeeting("owner-ada");
    advanceProcessing(id, { meeting: "processing", transcription: "retrying", summary: "pending" });
    await signIn(page);
    await page.goto(`/meetings/${id}/review`);
    const region = page.getByRole("status").filter({ hasText: "Transcript:" });
    await expect(region).toContainText("Transcript: Retrying (attempt 2 of 5)");

    advanceProcessing(id, { meeting: "failed", transcription: "failed" });
    await expect(region).toContainText(
      "Transcript: Failed after 5 attempts (stt_unavailable)",
      WAIT,
    );
    await expect(region).toContainText("Processing did not finish");
    await expect(page.locator("#note-status")).toHaveText("Processing needs attention");
  });
});

test.describe("live note, after capture stopped", () => {
  test("shows both jobs and announces the result", async ({ page }) => {
    const id = createCapturingMeeting("owner-ada", "processing", "Progress live note");
    advanceProcessing(id, { meeting: "processing", transcription: "pending" });
    await signIn(page);
    await page.goto(`/meetings/${id}`);
    const region = page.locator("#processing-progress");
    await expect(region).toContainText("Recording finished. Preparing the transcript.");
    await expect(region).toContainText("Transcribing: Waiting to start");
    // Focus in the notes keeps the hand-off from opening the draft (#66, tested in handoff.spec).
    await page.getByLabel("Your notes (saved as you type)").click();

    advanceProcessing(id, { meeting: "review", transcription: "succeeded", summary: "succeeded" });
    await expect(region).toContainText("Your draft is ready", WAIT);
    await expect(page.getByRole("link", { name: "Check again" })).toBeVisible();
  });

  // Issue #63: the live update used to say "use Check again" and Check again only reloaded the
  // live note, which had no way to the review. The link is in the page from the start (hidden)
  // and is revealed in place, so it is built from the meeting id of the page, never from the
  // answer of the status endpoint.
  test("the link to the draft appears in place, without a reload, and opens the review", async ({
    page,
  }) => {
    // A meeting that has a draft (made by the pipeline in real life), moved back to processing.
    const id = await createReviewMeeting("owner-ada");
    advanceProcessing(id, { meeting: "processing", transcription: "running", summary: "pending" });
    await signIn(page);
    await page.goto(`/meetings/${id}`);
    const region = page.locator("#processing-progress");
    await expect(region).toContainText("Transcribing: Running");
    await expect(page.getByRole("link", { name: "Open the draft" })).toBeHidden();
    // Focus in the notes keeps the hand-off from opening the draft (#66, tested in handoff.spec).
    await page.getByLabel("Your notes (saved as you type)").click();
    // A marker that a reload would remove: the page must update in place.
    await page.evaluate(() => {
      (window as unknown as { sameDocument: boolean }).sameDocument = true;
    });

    advanceProcessing(id, { meeting: "review", transcription: "succeeded", summary: "succeeded" });
    const link = region.getByRole("link", { name: "Open the draft" });
    await expect(link).toBeVisible(WAIT);
    await expect(link).toHaveAttribute("href", `/meetings/${id}/review`);
    await expect(region).toContainText("Your draft is ready.");
    await expect(region).not.toContainText("Use Check again to open it");
    // The announcement lives in its own live region, which names the button (#66).
    await expect(page.locator("#handoff-announce")).toHaveAttribute("role", "status");
    await expect(page.locator("#handoff-announce")).toHaveText(
      "Draft ready. Use the Open the draft button.",
    );
    expect(
      await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument),
    ).toBe(true);

    await link.click();
    await expect(page).toHaveURL(`/meetings/${id}/review`);
    await expect(page.locator("#note-status")).toHaveText("Draft: not published");
  });

  test("a failed processing offers the same way to the review page, where the retry is", async ({
    page,
  }) => {
    const id = createCapturingMeeting("owner-ada", "processing", "Review link failed note");
    advanceProcessing(id, { meeting: "processing", transcription: "running" });
    await signIn(page);
    await page.goto(`/meetings/${id}`);
    const region = page.locator("#processing-progress");
    await expect(region).toContainText("Transcribing: Running");

    advanceProcessing(id, { meeting: "failed", transcription: "failed" });
    const link = region.getByRole("link", { name: "See what happened and retry" });
    await expect(link).toBeVisible(WAIT);
    await expect(link).toHaveAttribute("href", `/meetings/${id}/review`);
    await expect(region).toContainText("Your rough notes are kept");
    await link.click();
    await expect(page).toHaveURL(`/meetings/${id}/review`);
    await expect(page.getByRole("heading", { name: "Transcription did not finish" })).toBeVisible();
  });
});

test.describe("live note at status review or failed (server-rendered)", () => {
  test("always carries a primary link to the review page, and nothing else changes it", async ({
    page,
  }) => {
    const review = await createReviewMeeting("owner-ada");
    const failed = createCapturingMeeting("owner-ada", "failed", "Review link failed on load");
    await signIn(page);

    await page.goto(`/meetings/${review}`);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Recording finished. A draft is ready for review." }),
    ).toBeVisible();
    const open = page.getByRole("link", { name: "Open the draft" });
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("href", `/meetings/${review}/review`);
    await expect(open).toHaveClass(/button/);
    await open.click();
    await expect(page).toHaveURL(`/meetings/${review}/review`);

    await page.goto(`/meetings/${failed}`);
    const retry = page.getByRole("link", { name: "See what happened and retry" });
    await expect(retry).toBeVisible();
    await expect(retry).toHaveAttribute("href", `/meetings/${failed}/review`);
    await retry.click();
    await expect(page).toHaveURL(`/meetings/${failed}/review`);
  });

  test("another owner never sees the link: the note is a plain 404", async ({ page, browser }) => {
    const id = await createReviewMeeting("owner-ada");
    const ben = createFreshOwner();
    const context = await browser.newContext();
    const other = await context.newPage();
    await signIn(other, ben.email);
    const response = await other.goto(`/meetings/${id}`);
    expect(response?.status()).toBe(404);
    await expect(other.getByRole("link", { name: /Open the draft|See what happened/ })).toHaveCount(
      0,
    );
    expect(await other.content()).not.toContain(`/meetings/${id}/review`);
    await context.close();
    // Positive control: the owner does get it.
    await signIn(page);
    await page.goto(`/meetings/${id}`);
    await expect(page.getByRole("link", { name: "Open the draft" })).toBeVisible();
  });
});

test.describe("home", () => {
  test("a meeting in processing updates its card and announces the change once", async ({
    page,
  }) => {
    // A fresh owner: only the first few processing meetings on a page are watched, and Ada's
    // list fills up with other tests' meetings.
    const owner = createFreshOwner();
    const title = `Progress card ${Math.random().toString(36).slice(2, 8)}`;
    const id = createCapturingMeeting(owner.id, "processing", title);
    advanceProcessing(id, { meeting: "processing", transcription: "running" });
    await signIn(page, owner.email);
    const card = page.locator(`[data-meeting-id="${id}"]`);
    await expect(card).toContainText("Transcribing");
    await expect(card.getByRole("link", { name: /View progress/ })).toBeVisible();

    advanceProcessing(id, { meeting: "review", transcription: "succeeded", summary: "succeeded" });
    await expect(card).toContainText("Draft ready for review", WAIT);
    await expect(card.getByRole("link", { name: /Review note/ })).toBeVisible();
    await expect(page.locator("#progress-announce")).toHaveText(
      `${title}: draft ready for review.`,
    );
  });
});

test.describe("settings, while a deletion runs", () => {
  test("the row follows the job to done, and the help line goes away", async ({ page }) => {
    // A fresh owner: the page polls until every deletion it lists has finished, and Ada's list
    // holds other tests' unfinished ones.
    const owner = createFreshOwner();
    const id = createDeletionInState(owner.id, "pending");
    await signIn(page, owner.email);
    await page.goto("/settings");
    const row = page.locator(`[data-deletion-id="${id}"]`);
    await expect(row).toContainText("Queued");
    await expect(row.getByRole("button", { name: /Retry deletion/ })).toHaveCount(0);
    const help = page.getByText("A deletion is still running.");
    await expect(help).toBeVisible();

    advanceDeletion(id, "running");
    await expect(row).toContainText("Deleting", WAIT);
    await expect(page.locator("#deletion-announce")).toContainText(`reference ${id}: Deleting.`);

    advanceDeletion(id, "retrying");
    await expect(row).toContainText("Retrying", WAIT);
    await expect(row).toContainText("Next attempt:");

    advanceDeletion(id, "succeeded");
    await expect(row).toContainText("Deleted", WAIT);
    await expect(row.getByText("Next attempt:")).toBeHidden();
    await expect(page.locator("#deletion-announce")).toContainText(`reference ${id}: Deleted.`);
    // Every listed deletion is finished, so polling has stopped and the "still running" line is gone.
    await expect(help).toBeHidden();
  });

  test("a failure brings the retry button, which is not there while the job runs", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    const id = createDeletionInState(owner.id, "pending");
    await signIn(page, owner.email);
    await page.goto("/settings");
    const row = page.locator(`[data-deletion-id="${id}"]`);
    await expect(row.getByRole("button", { name: /Retry deletion/ })).toHaveCount(0);

    advanceDeletion(id, "failed");
    await expect(row).toContainText("Failed", WAIT);
    await expect(row.getByRole("button", { name: /Retry deletion/ })).toBeVisible();
    await expect(page.locator("#deletion-announce")).toContainText(`reference ${id}: Failed.`);
    await expect(page.getByText("A deletion is still running.")).toBeHidden();
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the pages show the state on load and a reload shows the new state", async ({ page }) => {
    const owner = createFreshOwner();
    const id = await createReviewMeeting(owner.id);
    advanceProcessing(id, { meeting: "processing", transcription: "running", summary: "pending" });
    const deletion = createDeletionInState(owner.id, "pending");

    // Sign in with plain forms.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(owner.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    await page.goto(`/meetings/${id}/review`);
    await expect(page.getByText("Transcript: Running")).toBeVisible();
    await expect(page.getByRole("link", { name: "Check again" })).toBeVisible();
    advanceProcessing(id, { meeting: "failed", transcription: "failed" });
    // Nothing moves on its own...
    await expect(page.getByText("Transcript: Running")).toBeVisible();
    // ...and "Check again" shows the truth.
    await page.getByRole("link", { name: "Check again" }).click();
    await expect(page.getByRole("heading", { name: "Transcription did not finish" })).toBeVisible();

    // Live note (#63): a reload is the whole no-JS path and it now shows the way to the review.
    const live = createCapturingMeeting(owner.id, "processing", "No-JS review link");
    advanceProcessing(live, { meeting: "processing", transcription: "running" });
    await page.goto(`/meetings/${live}`);
    await expect(page.getByText("Transcribing: Running")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the draft" })).toBeHidden();
    advanceProcessing(live, {
      meeting: "review",
      transcription: "succeeded",
      summary: "succeeded",
    });
    await page.getByRole("link", { name: "Check again" }).click();
    const open = page.getByRole("link", { name: "Open the draft" });
    await expect(open).toBeVisible();
    await open.click();
    await expect(page).toHaveURL(`/meetings/${live}/review`);

    await page.goto("/settings");
    const row = page.locator(`[data-deletion-id="${deletion}"]`);
    await expect(row).toContainText("Queued");
    // The retry form of a row that might fail later is in the page but hidden until it applies.
    await expect(row.getByRole("button", { name: /Retry deletion/ })).toHaveCount(0);
    advanceDeletion(deletion, "failed");
    await page.getByRole("link", { name: "Check again" }).click();
    await expect(row).toContainText("Failed");
    await expect(row.getByRole("button", { name: /Retry deletion/ })).toBeVisible();
  });
});
