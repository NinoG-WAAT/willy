import { expect, test, type Page } from "@playwright/test";
import { createReviewMeeting } from "../support/e2e-db";

const PASSWORD = "willy-dev-password";
// Seeded draft note of owner A awaiting review (seeds/seed.ts).
const MEETING = "meeting-a-overdue";

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  return (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
}

function regenerateAll(page: Page, meetingId: string, form: Record<string, string>) {
  return page.request.post(`/meetings/${meetingId}/note/regenerate-all`, {
    headers: { origin: new URL(page.url()).origin },
    form,
    maxRedirects: 0,
  });
}

test("anonymous callers are sent to sign-in", async ({ request }) => {
  const res = await request.post(`/meetings/${MEETING}/note/regenerate-all`, {
    form: { confirm: "on" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toBe("/sign-in");
});

test("the owner can confirm and queue it; repeating it is harmless", async ({ page }) => {
  const token = await signIn(page, "ada@example.test");
  const first = await regenerateAll(page, MEETING, { confirm: "on", csrf_token: token });
  expect(first.status()).toBe(303);
  expect(first.headers()["location"]).toBe(
    `/meetings/${MEETING}/review?notice=draft_regeneration_queued#regenerate-draft`,
  );
  expect((await regenerateAll(page, MEETING, { confirm: "on", csrf_token: token })).status()).toBe(
    303,
  );
});

test("it needs the CSRF token", async ({ page }) => {
  await signIn(page, "ada@example.test");
  expect((await regenerateAll(page, MEETING, { confirm: "on" })).status()).toBe(403);
  expect(
    (await regenerateAll(page, MEETING, { confirm: "on", csrf_token: "forged" })).status(),
  ).toBe(403);
});

test("it is refused without the confirmation, because it replaces the owner's edits", async ({
  page,
}) => {
  const token = await signIn(page, "ada@example.test");
  expect((await regenerateAll(page, MEETING, { csrf_token: token })).status()).toBe(400);
});

test("another owner's meeting looks exactly like one that does not exist", async ({ page }) => {
  const token = await signIn(page, "ben@example.test");
  const form = { confirm: "on", csrf_token: token };
  expect((await regenerateAll(page, MEETING, form)).status()).toBe(404);
  expect((await regenerateAll(page, "nope", form)).status()).toBe(404);
});

test("malformed forms are rejected", async ({ page }) => {
  const token = await signIn(page, "ada@example.test");
  expect(
    (await regenerateAll(page, MEETING, { confirm: "on", csrf_token: token, owner: "x" })).status(),
  ).toBe(400);
});

test.describe("on the review screen", () => {
  test("states what is replaced and kept, and needs a ticked box (no JavaScript)", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("ada@example.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    // A meeting of its own: the status line shows the latest regeneration of a meeting, and other
    // specs queue section regenerations on the shared seeded one.
    const meetingId = await createReviewMeeting("owner-ada");
    await page.goto(`/meetings/${meetingId}/review`);

    const disclosure = page.locator("details#regenerate-draft");
    await disclosure.locator("summary").click();
    await expect(disclosure).toContainText("every section, decision and action item");
    await expect(disclosure).toContainText("your edits");
    await expect(disclosure).toContainText("rough notes");
    await expect(disclosure).toContainText("transcript");
    const box = disclosure.getByRole("checkbox", { name: /replace my edits/i });
    await expect(box).toHaveAttribute("required", "");

    await box.check();
    await disclosure.getByRole("button", { name: "Regenerate whole draft" }).click();
    await expect(page).toHaveURL(/notice=draft_regeneration_queued/);
    await expect(page.getByText("Regenerating the whole draft.")).toBeVisible();
    await expect(page.locator('[data-progress="regeneration"][data-scope="all"]')).toContainText(
      /Regeneration: (Waiting to start|Running|Done)/,
    );
    await context.close();
  });

  test("a published note has no such control", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await page.goto("/meetings/meeting-a-published/review");
    await expect(page.locator("#regenerate-draft")).toHaveCount(0);
  });
});
