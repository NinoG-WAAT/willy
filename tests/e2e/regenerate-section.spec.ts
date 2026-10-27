import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "willy-dev-password";
// Seeded draft note of owner A awaiting review (seeds/seed.ts).
const MEETING = "meeting-a-overdue";
const SECTION = "meeting-a-overdue-note-section-0";

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  return (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
}

function regenerate(page: Page, meetingId: string, form: Record<string, string>, origin: string) {
  return page.request.post(`/meetings/${meetingId}/note/regenerate`, {
    headers: { origin },
    form,
    maxRedirects: 0,
  });
}

test("anonymous callers are sent to sign-in", async ({ request }) => {
  const res = await request.post(`/meetings/${MEETING}/note/regenerate`, {
    form: { section_id: SECTION },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toBe("/sign-in");
});

test("the owner can request a regeneration; repeating it is harmless", async ({ page }) => {
  const token = await signIn(page, "ada@example.test");
  const origin = new URL(page.url()).origin;
  const first = await regenerate(page, MEETING, { section_id: SECTION, csrf_token: token }, origin);
  expect(first.status()).toBe(303);
  expect(first.headers()["location"]).toBe(
    `/meetings/${MEETING}/review?notice=regeneration_queued#section-${SECTION}`,
  );
  const again = await regenerate(page, MEETING, { section_id: SECTION, csrf_token: token }, origin);
  expect(again.status()).toBe(303);
});

test("it needs the CSRF token", async ({ page }) => {
  await signIn(page, "ada@example.test");
  const origin = new URL(page.url()).origin;
  expect((await regenerate(page, MEETING, { section_id: SECTION }, origin)).status()).toBe(403);
  expect(
    (
      await regenerate(page, MEETING, { section_id: SECTION, csrf_token: "forged" }, origin)
    ).status(),
  ).toBe(403);
});

test("another owner's section looks exactly like one that does not exist", async ({ page }) => {
  const token = await signIn(page, "ben@example.test");
  const origin = new URL(page.url()).origin;
  const foreign = await regenerate(
    page,
    MEETING,
    { section_id: SECTION, csrf_token: token },
    origin,
  );
  const unknown = await regenerate(
    page,
    MEETING,
    { section_id: "nope", csrf_token: token },
    origin,
  );
  expect(foreign.status()).toBe(404);
  expect(unknown.status()).toBe(404);
});

test("malformed forms are rejected", async ({ page }) => {
  const token = await signIn(page, "ada@example.test");
  const origin = new URL(page.url()).origin;
  const extra = await regenerate(
    page,
    MEETING,
    { section_id: SECTION, csrf_token: token, owner: "x" },
    origin,
  );
  expect(extra.status()).toBe(400);
  const missing = await regenerate(page, MEETING, { csrf_token: token }, origin);
  expect(missing.status()).toBe(400);
});
