import { expect, test, type Browser, type Page } from "@playwright/test";
import { createReviewMeeting } from "../support/e2e-db";
import { createFreshOwner } from "../support/journey-db";

/**
 * Issue #103: one transcript label ("Speaker 1": all a transcriber without speaker separation can
 * say) becomes several people. Lines are ticked in the transcript panel and given a name, on any
 * draft, by plain form (no JavaScript needed). Validation, the owner boundary and the published
 * state are covered here; the rules themselves are in the integration tests.
 */

const PASSWORD = "willy-dev-password";

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

/** A draft of its own for a fresh owner: three lines, "Speaker 1" says the first and the third. */
async function draft(page: Page): Promise<{ id: string; email: string }> {
  const owner = createFreshOwner();
  await signIn(page, owner.email);
  const id = await createReviewMeeting(owner.id);
  return { id, email: owner.email };
}

const lineNames = (page: Page) => page.locator("#transcript-panel .seg-speaker").allTextContents();
const chips = (page: Page) => page.locator(".speaker-chip .speaker-name").allTextContents();

async function openPanel(page: Page): Promise<void> {
  const panel = page.locator("#transcript-panel");
  if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await panel.locator("summary").click();
  }
}

test("ticked lines get the name; the label as first transcribed is kept and the chips follow", async ({
  page,
}) => {
  const { id } = await draft(page);
  await page.goto(`/meetings/${id}/review`);
  expect(await chips(page)).toEqual(["Speaker 1", "Speaker 2"]);
  await openPanel(page);

  // The third line (Speaker 1) is the second person: rename could never separate it.
  await page
    .getByRole("checkbox", { name: /Select the line at .* by Speaker 1/ })
    .last()
    .check();
  await page.getByLabel("Assign the ticked lines to").fill("  Grace   Hopper ");
  await page.getByRole("button", { name: "Assign" }).click();

  await expect(page).toHaveURL(/notice=speaker_assigned/);
  await expect(page.getByText("Lines assigned to the speaker.")).toBeVisible();
  // The panel stays open after an assign, so the next lines can be done straight away.
  await expect(page.locator("#transcript-panel")).toHaveJSProperty("open", true);
  expect(await lineNames(page)).toEqual(["Speaker 1", "Speaker 2", "Grace Hopper"]);
  expect(await chips(page)).toEqual(["Speaker 1", "Speaker 2", "Grace Hopper"]);
});

test("works without JavaScript, on a phone too", async ({ browser }, info) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: info.project.use.viewport ?? { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const { id } = await draft(page);
  await page.goto(`/meetings/${id}/review`);
  await openPanel(page);
  await page.getByRole("checkbox", { name: /Select the line at .* by Speaker 2/ }).check();
  await page.getByLabel("Assign the ticked lines to").fill("Grace");
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText("Lines assigned to the speaker.")).toBeVisible();
  expect(await lineNames(page)).toEqual(["Speaker 1", "Grace", "Speaker 1"]);
  await context.close();
});

test("a rejected assign explains itself, keeps the name and the ticked lines, and leaves the panel open", async ({
  page,
}) => {
  const { id } = await draft(page);
  await page.goto(`/meetings/${id}/review`);
  await openPanel(page);

  // No line ticked.
  await page.getByLabel("Assign the ticked lines to").fill("Grace");
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.locator(".field-error")).toContainText("Select at least one line.");
  await expect(page.locator("#transcript-panel")).toHaveJSProperty("open", true);
  await expect(page.getByLabel("Assign the ticked lines to")).toHaveValue("Grace");

  // A line ticked, no name: the ticked line stays ticked.
  await page.getByLabel("Assign the ticked lines to").fill("");
  await page.getByRole("checkbox", { name: /Select the line at .* by Speaker 2/ }).check();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.locator(".field-error")).toContainText("Enter a name.");
  await expect(
    page.getByRole("checkbox", { name: /Select the line at .* by Speaker 2/ }),
  ).toBeChecked();
  expect(await lineNames(page)).toEqual(["Speaker 1", "Speaker 2", "Speaker 1"]);
});

test("suggests the speakers and the attendees by name, and assigns nothing by itself", async ({
  page,
}) => {
  const { id } = await draft(page);
  await page.goto(`/meetings/${id}/review`);
  await openPanel(page);
  const options = await page
    .locator("#assign-names option")
    .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
  expect(options).toEqual(["Speaker 1", "Speaker 2", "Ada Lovelace", "Grace Hopper"]);
  expect(await lineNames(page)).toEqual(["Speaker 1", "Speaker 2", "Speaker 1"]);
});

test("shift-click ticks a range and the count is announced (JavaScript)", async ({ page }) => {
  const { id } = await draft(page);
  await page.goto(`/meetings/${id}/review`);
  await openPanel(page);
  const picks = page.locator("input.seg-pick");
  await picks.nth(0).click();
  await expect(page.locator("#assign-status")).toHaveText("1 line selected.");
  await picks.nth(2).click({ modifiers: ["Shift"] });
  await expect(picks.nth(1)).toBeChecked();
  await expect(page.locator("#assign-status")).toHaveText("3 lines selected.");
});

test("a published note has no assign form and no checkboxes", async ({ page }) => {
  await signIn(page, "ada@example.test");
  await page.goto("/meetings/meeting-a-published/review");
  await expect(page.locator("#assign-form")).toHaveCount(0);
  await expect(page.locator("input.seg-pick")).toHaveCount(0);
});

test("another owner cannot assign lines of this meeting, and nothing changes", async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  const { id } = await draft(page);
  await page.goto(`/meetings/${id}/review`);
  const other = await browser.newContext();
  const intruder = await other.newPage();
  const stranger = createFreshOwner();
  await signIn(intruder, stranger.email);
  const token =
    (await intruder.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
  const response = await intruder.request.post(`/meetings/${id}/review`, {
    headers: { origin: new URL(intruder.url()).origin },
    form: { csrf_token: token, intent: "assign_speaker", to: "Hacked", line: "0" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(404);
  await other.close();
  await page.reload();
  expect(await chips(page)).toEqual(["Speaker 1", "Speaker 2"]);
});

test("the form needs the CSRF token and rejects foreign fields", async ({ page }) => {
  const { id } = await draft(page);
  await page.goto(`/meetings/${id}/review`);
  const origin = new URL(page.url()).origin;
  const token = (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
  const noToken = await page.request.post(`/meetings/${id}/review`, {
    headers: { origin },
    form: { intent: "assign_speaker", to: "X", line: "0" },
    maxRedirects: 0,
  });
  expect(noToken.status()).toBe(403);
  const foreign = await page.request.post(`/meetings/${id}/review`, {
    headers: { origin },
    form: { csrf_token: token, intent: "assign_speaker", to: "X", line: "0", owner: "evil" },
    maxRedirects: 0,
  });
  expect(foreign.status()).toBe(400);
  const unknownLine = await page.request.post(`/meetings/${id}/review`, {
    headers: { origin },
    form: { csrf_token: token, intent: "assign_speaker", to: "X", line: "424242" },
    maxRedirects: 0,
  });
  expect(unknownLine.status()).toBe(422);
});
