import { expect, test, type Page } from "@playwright/test";
import {
  countTranscribeJobs,
  createCapturingMeeting,
  createReviewMeeting,
  meetingStatus,
  reviewFolderName,
} from "../support/e2e-db";

const PASSWORD = "willy-dev-password";
// Seeded draft of owner A with an overdue open action item (seeds/seed.ts). Read-only here.
const OVERDUE_MEETING = "meeting-a-overdue";

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  return (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
}

test("journey 2: correct a speaker, edit a decision and an action item, publish to a folder", async ({
  page,
}) => {
  await signIn(page, "ada@example.test");
  const id = await createReviewMeeting("owner-ada");
  await page.goto(`/meetings/${id}/review`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(id);
  await expect(page.locator("#note-status")).toHaveText("Draft: not published");

  // Layout: transcript beside the summary on a desktop, intentionally stacked on a phone.
  const summary = await page.locator("#summary").boundingBox();
  const transcript = await page.locator("#transcript").boundingBox();
  if (!summary || !transcript) throw new Error("layout boxes are missing");
  const phone = (page.viewportSize()?.width ?? 1280) < 600;
  if (phone) {
    await expect(page.getByRole("link", { name: "Jump to the transcript" })).toBeVisible();
    expect(transcript.y).toBeGreaterThan(summary.y + summary.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 0,
    );
  } else {
    await expect(page.getByRole("link", { name: "Jump to the transcript" })).toBeHidden();
    expect(transcript.x).toBeGreaterThan(summary.x + summary.width - 1);
  }

  // Correct a speaker: applied to every line of that speaker.
  await page.getByLabel("Speaker to rename").selectOption("Speaker 1");
  await page.getByLabel("New name").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Rename speaker" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Speaker renamed" })).toBeVisible();
  await expect(page.locator(".transcript li", { hasText: "Ada Lovelace" })).toHaveCount(2);
  await expect(page.locator(".transcript li", { hasText: "Speaker 1" })).toHaveCount(0);

  // Edit a decision.
  await page.locator(`#decision-text-${id}-dec-0`).fill("Ship the beta in December");
  await page.getByRole("button", { name: /Save decision/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Decision saved" })).toBeVisible();

  // Edit an action item: owner restricted to attendees, due date in the meeting's zone.
  await page.locator(`#act-text-${id}-act-0`).fill("Send the pricing deck");
  await page.locator(`#act-owner-${id}-act-0`).selectOption({ label: "Grace Hopper" });
  await page.locator(`#act-due-${id}-act-0`).fill("2026-11-20");
  await page.getByRole("button", { name: /Save action item/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Action item saved" })).toBeVisible();

  // A refresh keeps everything.
  await page.reload();
  await expect(page.locator(`#decision-text-${id}-dec-0`)).toHaveValue("Ship the beta in December");
  await expect(page.locator(`#act-text-${id}-act-0`)).toHaveValue("Send the pricing deck");
  await expect(page.locator(`#act-due-${id}-act-0`)).toHaveValue("2026-11-20");
  await expect(page.locator(`#act-owner-${id}-act-0`)).toHaveValue(`${id}-a2`);
  await expect(page.locator(`#action-${id}-act-0`)).toContainText("Due");
  await expect(page.locator(".transcript li", { hasText: "Ada Lovelace" })).toHaveCount(2);

  // Publishing is explicit: without the confirmation nothing is published.
  await page.getByLabel("Private folder").selectOption({ label: reviewFolderName(id) });
  await page.getByRole("button", { name: "Publish to folder" }).click();
  await expect(page.getByRole("alert")).toContainText("not saved");
  await expect(page.getByText("Tick the box to confirm")).toBeVisible();
  expect(meetingStatus(id)).toBe("review");

  await page.getByLabel("Private folder").selectOption({ label: reviewFolderName(id) });
  await page.getByLabel("I have reviewed this note and want to publish it.").check();
  await page.getByRole("button", { name: "Publish to folder" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Published." })).toBeVisible();
  await expect(page.locator("#note-status")).toHaveText("Published");
  await expect(page.getByRole("button", { name: "Reopen for editing" })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(meetingStatus(id)).toBe("published");

  // And the published state survives a refresh.
  await page.reload();
  await expect(page.locator("#note-status")).toHaveText("Published");
  await expect(page.locator("#publish")).toContainText(reviewFolderName(id));
  await expect(page.getByText("Ship the beta in December")).toBeVisible();
});

test("a source link marks the cited transcript lines", async ({ page }) => {
  await signIn(page, "ada@example.test");
  const id = await createReviewMeeting("owner-ada");
  await page.goto(`/meetings/${id}/review`);
  await expect(page.locator(".transcript li.is-source")).toHaveCount(0);
  // Unsaved typing is not lost: the marks move in place.
  await page.locator(`#decision-text-${id}-dec-0`).fill("Unsaved wording");
  await page
    .locator(`#decision-${id}-dec-0`)
    .getByRole("link", { name: /Source: transcript/ })
    .click();
  await expect(page.locator(".transcript li.is-source")).toHaveCount(1);
  await expect(page.locator(".transcript li.is-source .seg-flag")).toBeVisible();
  await expect(page.locator(`#decision-text-${id}-dec-0`)).toHaveValue("Unsaved wording");
});

test("a search hit opens the review with the match and its source marked", async ({ page }) => {
  await signIn(page, "ada@example.test");
  const id = await createReviewMeeting("owner-ada");
  await page.goto(`/meetings/${id}/review?q=roadmap&hit=note_section:${id}-sec-0`);
  await expect(page.locator(`#section-${id}-sec-0`)).toContainText("Search match");
  await expect(page.locator(".transcript li.is-source")).toHaveCount(3);
  // A hit naming another note's item marks nothing.
  await page.goto(`/meetings/${id}/review?hit=note_section:meeting-a-overdue-note-section-0`);
  await expect(page.getByText("Search match")).toHaveCount(0);
  await expect(page.locator(".transcript li.is-source")).toHaveCount(0);
});

test("an overdue action item says so in words", async ({ page }) => {
  await signIn(page, "ada@example.test");
  await page.goto(`/meetings/${OVERDUE_MEETING}/review`);
  await expect(page.locator("#action-items .overdue-flag")).toHaveText("Overdue");
  await expect(page.locator("#action-items")).toContainText(/Due .*(CET|CEST)/);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the review works as plain forms: edit, source link, publish", async ({ page }) => {
    await signIn(page, "ada@example.test");
    const id = await createReviewMeeting("owner-ada");
    await page.goto(`/meetings/${id}/review`);
    await page.locator(`#body-${id}-sec-0`).fill("Rewritten summary.");
    await page
      .getByRole("button", { name: /Save section/ })
      .first()
      .click();
    await expect(page.getByText("Section saved.")).toBeVisible();
    await expect(page.locator(`#body-${id}-sec-0`)).toHaveValue("Rewritten summary.");

    await page
      .locator(`#decision-${id}-dec-0`)
      .getByRole("link", { name: /Source: transcript/ })
      .click();
    await expect(page).toHaveURL(/review\?src=\d+-\d+#seg-/);
    await expect(page.locator(".transcript li.is-source .seg-flag")).toBeVisible();

    await page.getByLabel("Private folder").selectOption({ label: reviewFolderName(id) });
    await page.getByLabel("I have reviewed this note and want to publish it.").check();
    await page.getByRole("button", { name: "Publish to folder" }).click();
    await expect(page.locator("#note-status")).toHaveText("Published");
  });
});

test("a failed transcription offers a retry that queues exactly one job", async ({ page }) => {
  await signIn(page, "ada@example.test");
  const id = createCapturingMeeting("owner-ada", "failed");
  await page.goto(`/meetings/${id}/review`);
  await expect(page.getByRole("heading", { name: "Transcription did not finish" })).toBeVisible();
  await page.getByRole("button", { name: "Retry transcription" }).click();
  await expect(page.getByText("Transcription restarted.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /being prepared/ })).toBeVisible();
  expect(meetingStatus(id)).toBe("processing");
  expect(countTranscribeJobs(id)).toBe(1);
});

test("a meeting that has not been captured yet belongs to the live note", async ({ page }) => {
  await signIn(page, "ada@example.test");
  const id = createCapturingMeeting("owner-ada", "scheduled");
  await page.goto(`/meetings/${id}/review`);
  await expect(page).toHaveURL(`/meetings/${id}`);
});

test("anonymous visitors are sent to sign-in", async ({ page }) => {
  await page.goto(`/meetings/${OVERDUE_MEETING}/review`);
  await expect(page).toHaveURL(/\/sign-in/);
});

test("another owner's review, edits and publish look exactly like unknown ones", async ({
  page,
}) => {
  const adasId = await createReviewMeeting("owner-ada");
  const token = await signIn(page, "ben@example.test");
  const origin = new URL(page.url()).origin;

  const foreign = await page.goto(`/meetings/${adasId}/review`);
  const unknown = await page.goto("/meetings/does-not-exist/review");
  expect(foreign?.status()).toBe(404);
  expect(unknown?.status()).toBe(404);

  const post = (path: string, form: Record<string, string>) =>
    page.request.post(path, { headers: { origin }, form, maxRedirects: 0 });
  const attempts = [
    { intent: "edit_section", id: `${adasId}-sec-0`, body: "Hacked" },
    { intent: "rename_speaker", from: "Speaker 1", to: "Hacked" },
    { intent: "publish", folder: "folder-b-board", confirm: "on" },
  ];
  for (const form of attempts) {
    expect(
      (await post(`/meetings/${adasId}/review`, { csrf_token: token, ...form })).status(),
    ).toBe(404);
    expect(
      (await post("/meetings/does-not-exist/review", { csrf_token: token, ...form })).status(),
    ).toBe(404);
  }
  expect(meetingStatus(adasId)).toBe("review");
});

test("every review mutation needs the CSRF token", async ({ page }) => {
  await signIn(page, "ada@example.test");
  const id = await createReviewMeeting("owner-ada");
  const origin = new URL(page.url()).origin;
  const form = { intent: "edit_section", id: `${id}-sec-0`, body: "No token" };
  const missing = await page.request.post(`/meetings/${id}/review`, { headers: { origin }, form });
  const forged = await page.request.post(`/meetings/${id}/review`, {
    headers: { origin },
    form: { ...form, csrf_token: "forged" },
  });
  expect(missing.status()).toBe(403);
  expect(forged.status()).toBe(403);
});

test("a malformed review form is a bad request", async ({ page }) => {
  const token = await signIn(page, "ada@example.test");
  const id = await createReviewMeeting("owner-ada");
  const origin = new URL(page.url()).origin;
  const res = await page.request.post(`/meetings/${id}/review`, {
    headers: { origin },
    form: {
      csrf_token: token,
      intent: "edit_section",
      id: `${id}-sec-0`,
      body: "x",
      owner_id: "B",
    },
  });
  expect(res.status()).toBe(400);
});
