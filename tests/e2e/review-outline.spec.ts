import { expect, test, type Page } from "@playwright/test";
import {
  archiveMeeting,
  createReviewMeeting,
  sectionEdited,
  setSectionText,
  setSegmentStarts,
} from "../support/e2e-db";

const PASSWORD = "willy-dev-password";

// A worker runs one test at a time, so this holds the current test's meetings. They are archived
// afterwards: the Inbox is paged and this spec adds a lot of drafts for the seeded owners.
const created: string[] = [];
async function reviewMeeting(ownerId: string): Promise<string> {
  const id = await createReviewMeeting(ownerId);
  created.push(id);
  return id;
}
test.afterEach(() => {
  for (const id of created.splice(0)) archiveMeeting(id);
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

const RISKS = [
  "- Pricing is still pending: the vendor has not sent the revised quote",
  "- Hiring is slower than planned",
  "  - Two engineering roles are open",
  "  - The recruiter changed twice",
  "- Vendor lock-in on the transcription provider",
].join("\n");

/** A review meeting whose Summary cites 2:10 to 3:45 and whose Risks is a dash-prefixed list. */
async function weeklyReview(page: Page): Promise<string> {
  const id = await reviewMeeting("owner-ada");
  setSegmentStarts(id, { 0: 130_000, 1: 150_000, 10_000: 225_000 });
  setSectionText(id, 1, RISKS, { from: 1, to: 10_000 });
  await signIn(page, "ada@example.test");
  return id;
}

test("the summary is read-only by default: an outline, not a form", async ({ page }) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review`);

  await expect(page.getByRole("heading", { level: 2, name: "Summary" })).toBeVisible();
  await expect(
    page.locator("#summary").getByRole("heading", { level: 3, name: "Summary" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Risks" })).toBeVisible();
  // No input fields for the summary: no textarea, no per-section Save, no "Text of" label.
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save section/ })).toHaveCount(0);
  await expect(page.getByLabel(/^Text of/)).toHaveCount(0);
  // The text is plain content.
  await expect(page.locator(`#section-${id}-sec-0`)).toContainText("We reviewed the roadmap.");
  // Untouched generated sections are not marked as edited.
  await expect(page.getByText("Edited by you")).toHaveCount(0);
});

test("a source chip shows real meeting times and still jumps to the transcript range", async ({
  page,
}) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review`);
  const chip = page.locator(`#section-${id}-sec-0 a.source-chip`);
  await expect(chip).toContainText("2:10 to 3:45");
  await expect(chip).toHaveAccessibleName("Source: transcript 2:10 to 3:45");
  await chip.click();
  await expect(page.locator(".transcript li.is-source")).toHaveCount(3);
});

test("a dash-prefixed body renders as a real nested list", async ({ page }) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review`);
  const risks = page.locator(`#section-${id}-sec-1`);
  await expect(risks.locator(".outline-body > ul > li")).toHaveCount(3);
  await expect(risks.locator(".outline-body > ul ul li")).toHaveText([
    "Two engineering roles are open",
    "The recruiter changed twice",
  ]);
  // No dash is left in the text: the bullets are the list markers.
  await expect(risks.locator(".outline-body > ul > li").first()).toContainText(
    "Pricing is still pending: the vendor has not sent the revised quote",
  );
});

test("hostile text renders as literal text, never as markup or a link", async ({ page }) => {
  const id = await weeklyReview(page);
  const hostile = "<img src=x onerror=alert(1)> and [click here](https://evil.example/steal)";
  setSectionText(id, 0, `${hostile}\n\n- <b>bold</b> item\n- <script>alert(2)</script>`);
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.goto(`/meetings/${id}/review`);
  const summary = page.locator(`#section-${id}-sec-0`);
  await expect(summary).toContainText(hostile);
  await expect(summary).toContainText("<b>bold</b> item");
  await expect(summary).toContainText("<script>alert(2)</script>");
  await expect(summary.locator("img, b, script")).toHaveCount(0);
  await expect(summary.locator('a[href*="evil.example"]')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test("Edit opens only that section; Cancel returns to reading", async ({ page }) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review`);
  await page.getByRole("link", { name: "Edit section Risks" }).click();
  await expect(page).toHaveURL(new RegExp(`review\\?edit=${id}-sec-1#section-${id}-sec-1$`));

  await expect(page.locator("textarea")).toHaveCount(1);
  const area = page.getByLabel("Text of “Risks”");
  await expect(area).toBeVisible();
  await expect(area).toBeFocused();
  await expect(area).toHaveValue(RISKS);
  // The other section is still plain text, with its own Edit link.
  await expect(page.locator(`#section-${id}-sec-0 textarea`)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit section Summary" })).toBeVisible();

  await page.getByRole("link", { name: "Cancel editing Risks" }).click();
  await expect(page).not.toHaveURL(/edit=/);
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.locator(`#section-${id}-sec-1`)).toContainText("Hiring is slower than planned");
});

test("the textarea grows with its text (script on)", async ({ page }) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review?edit=${id}-sec-1`);
  const area = page.getByLabel("Text of “Risks”");
  const before = (await area.boundingBox())?.height ?? 0;
  await area.fill(Array.from({ length: 30 }, (_, i) => `- Risk number ${String(i)}`).join("\n"));
  await expect
    .poll(async () => (await area.boundingBox())?.height ?? 0)
    .toBeGreaterThan(before + 200);
});

test("saving changed text shows the edited marker on that section only", async ({ page }) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review?edit=${id}-sec-1`);
  await page.getByLabel("Text of “Risks”").fill("- Pricing is settled\n- Hiring is on track");
  await page.getByRole("button", { name: /Save section/ }).click();
  await expect(page.getByText("Section saved.")).toBeVisible();
  await expect(page).not.toHaveURL(/edit=/);
  const risks = page.locator(`#section-${id}-sec-1`);
  await expect(risks.getByText("Edited by you")).toBeVisible();
  await expect(risks.locator(".outline-body > ul > li")).toHaveText([
    "Pricing is settled",
    "Hiring is on track",
  ]);
  await expect(page.getByText("Edited by you")).toHaveCount(1);
  expect(sectionEdited(id, 1)).toBe(true);
  expect(sectionEdited(id, 0)).toBe(false);
});

test("saving a section without changing it does not mark it as edited", async ({ page }) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review?edit=${id}-sec-1`);
  await page.getByRole("button", { name: /Save section/ }).click();
  await expect(page.getByText("Section saved.")).toBeVisible();
  await expect(page.getByText("Edited by you")).toHaveCount(0);
  expect(sectionEdited(id, 1)).toBe(false);
});

test("a rejected save re-opens that section with the typed text and the error", async ({
  page,
}) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review?edit=${id}-sec-1`);
  const tooLong = `- ${"long ".repeat(4100)}`;
  // The browser's maxlength is only a convenience: the server is what refuses, so drop it here.
  await page.getByLabel("Text of “Risks”").evaluate((el) => {
    el.removeAttribute("maxlength");
  });
  await page.getByLabel("Text of “Risks”").fill(tooLong);
  await page.getByRole("button", { name: /Save section/ }).click();

  const area = page.getByLabel("Text of “Risks”");
  await expect(area).toBeVisible();
  await expect(page.locator(`#body-error-${id}-sec-1`)).toHaveText("Use at most 20000 characters.");
  await expect(area).toHaveAttribute("aria-invalid", "true");
  await expect(area).toHaveValue(tooLong);
  // Only that section is open, and nothing was stored.
  await expect(page.locator("textarea")).toHaveCount(1);
  expect(sectionEdited(id, 1)).toBe(false);

  // An empty body is refused the same way.
  await area.fill("   ");
  await page.getByRole("button", { name: /Save section/ }).click();
  await expect(page.getByText("Write something.")).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(1);
});

test("keyboard only: Edit, type, Save, and back to reading", async ({ page }) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review`);
  const edit = page.getByRole("link", { name: "Edit section Summary" });
  await edit.focus();
  await page.keyboard.press("Enter");
  const area = page.getByLabel("Text of “Summary”");
  await expect(area).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Typed with the keyboard.");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Save section Summary" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Section saved.")).toBeVisible();
  await expect(page.locator(`#section-${id}-sec-0`)).toContainText("Typed with the keyboard.");
  await expect(page.locator("textarea")).toHaveCount(0);
});

test("regenerating a section is one quiet disclosure with the replace warning", async ({
  page,
}) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review`);
  const risks = page.locator(`#section-${id}-sec-1`);
  const menu = risks.locator("details.outline-menu");
  // Closed: no big button, the warning is not in the way.
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(risks.getByRole("button", { name: /Regenerate this section/ })).toBeHidden();
  await menu.locator("summary").click();
  await expect(risks.getByText(/including your edits to it/)).toBeVisible();
  await risks.getByRole("button", { name: /Regenerate this section/ }).click();
  await expect(page).toHaveURL(/notice=regeneration_queued/);
  const line = page.locator(`[data-progress="regeneration"][data-section-id="${id}-sec-1"]`);
  await expect(line).toContainText("Regeneration:");
  // The disclosure stays open while the request is running.
  await expect(page.locator(`#section-${id}-sec-1 details.outline-menu`)).toHaveAttribute(
    "open",
    "",
  );
});

test("the outline fits a phone without horizontal scroll", async ({ page }) => {
  const id = await weeklyReview(page);
  await page.goto(`/meetings/${id}/review?edit=${id}-sec-1`);
  const width = page.viewportSize()?.width ?? 0;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
});

test.describe("another owner", () => {
  test("cannot open ?edit= on owner A's meeting or use A's section id on their own", async ({
    page,
  }) => {
    const id = await reviewMeeting("owner-ada");
    const own = await reviewMeeting("owner-ben");
    await signIn(page, "ben@example.test");

    // A's meeting looks exactly like an unknown one, edit parameter or not.
    const foreign = await page.goto(`/meetings/${id}/review?edit=${id}-sec-0`);
    expect(foreign?.status()).toBe(404);
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.getByText("We reviewed the roadmap.")).toHaveCount(0);

    // On B's own meeting, A's section id opens nothing (and is not echoed anywhere).
    const response = await page.goto(`/meetings/${own}/review?edit=${id}-sec-0`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("textarea")).toHaveCount(0);
    expect(await page.content()).not.toContain(`${id}-sec-0`);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("Edit and Cancel are plain links, Save is a plain form", async ({ page }) => {
    const id = await weeklyReview(page);
    await page.goto(`/meetings/${id}/review`);
    await page.getByRole("link", { name: "Edit section Risks" }).click();
    await expect(page.locator("textarea")).toHaveCount(1);
    await page.getByRole("link", { name: "Cancel editing Risks" }).click();
    await expect(page.locator("textarea")).toHaveCount(0);

    await page.getByRole("link", { name: "Edit section Risks" }).click();
    await page.getByLabel("Text of “Risks”").fill("Plain form save.");
    await page.getByRole("button", { name: /Save section/ }).click();
    await expect(page.getByText("Section saved.")).toBeVisible();
    await expect(page.locator(`#section-${id}-sec-1`)).toContainText("Plain form save.");

    // The regenerate disclosure works as a native details element.
    await page.locator(`#section-${id}-sec-1 details.outline-menu summary`).click();
    await page
      .locator(`#section-${id}-sec-1`)
      .getByRole("button", { name: /Regenerate this section/ })
      .click();
    await expect(page).toHaveURL(/notice=regeneration_queued/);
  });
});
