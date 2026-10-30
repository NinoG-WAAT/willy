import { expect, test, type Page } from "@playwright/test";
import { expireSession } from "../support/e2e-db";

const PASSWORD = "willy-dev-password";

async function signIn(page: Page, email: string, password = PASSWORD, next = "/"): Promise<void> {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("anonymous visitors are sent to sign-in and returned to where they were going", async ({
  page,
}) => {
  await page.goto("/search?q=roadmap");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsearch%3Fq%3Droadmap$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("the sign-in page is accessible: landmarks, labelled fields, no horizontal scroll", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page).toHaveTitle("Sign in - Willycrumbs");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a wrong password shows one generic error and does not sign in", async ({ page }) => {
  await signIn(page, "ada@example.test", "wrong-password");
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("an unknown email gets the same error as a wrong password", async ({ page }) => {
  await signIn(page, "nobody@example.test", "whatever");
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect");
});

test("signing in shows the owner, survives a refresh, and signing out ends the session", async ({
  page,
}) => {
  await signIn(page, "ada@example.test");
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Signed in as Ada Founder")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Signed in as Ada Founder")).toBeVisible();

  // On a phone Sign out lives in the tab bar's More menu (#70); on desktop it is in the sidebar.
  if ((page.viewportSize()?.width ?? 1280) < 600) await page.locator(".tabbar summary").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signed-out$/);
  await expect(page.getByRole("heading", { level: 1, name: "You are signed out" })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("session cookie is HttpOnly, Secure and SameSite=Lax", async ({ page, context }) => {
  await signIn(page, "ben@example.test");
  const cookie = (await context.cookies()).find((c) => c.name === "__Host-willy_session");
  expect(cookie).toBeDefined();
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  expect(cookie?.path).toBe("/");
});

test("owner B is a different owner from owner A", async ({ page }) => {
  await signIn(page, "ben@example.test");
  await expect(page.getByText("Signed in as Ben Founder")).toBeVisible();
});

test("an open redirect through next is ignored", async ({ page }) => {
  await signIn(page, "ada@example.test", PASSWORD, "https://evil.example/phish");
  await expect(page).toHaveURL("/");
});

test("sign-out without a CSRF token is rejected and keeps the session", async ({
  page,
  request,
}) => {
  await signIn(page, "ada@example.test");
  const origin = new URL(page.url()).origin;
  const noToken = await page.request.post("/sign-out", {
    headers: { origin },
    form: {},
    maxRedirects: 0,
  });
  expect(noToken.status()).toBe(403);
  const wrongToken = await page.request.post("/sign-out", {
    headers: { origin },
    form: { csrf_token: "forged" },
    maxRedirects: 0,
  });
  expect(wrongToken.status()).toBe(403);
  await page.goto("/");
  await expect(page.getByText("Signed in as Ada Founder")).toBeVisible();
  // Anonymous callers never reach the handler at all.
  const anonymous = await request.post("/sign-out", { form: {}, maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
});

test("a cross-origin POST is rejected even with a valid token", async ({ page }) => {
  await signIn(page, "ada@example.test");
  const token = await page.locator("input[name=csrf_token]").first().getAttribute("value");
  expect(token).toBeTruthy();
  const res = await page.request.post("/sign-out", {
    headers: { origin: "https://evil.example" },
    form: { csrf_token: token ?? "" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(403);
});

test("an expired session lands on the session-expired page, then on sign-in", async ({
  page,
  context,
}) => {
  await signIn(page, "ada@example.test");
  const cookie = (await context.cookies()).find((c) => c.name === "__Host-willy_session");
  expireSession(cookie?.value ?? "");
  await page.goto("/");
  await expect(page).toHaveURL(/\/session-expired/);
  await expect(page.getByRole("heading", { level: 1, name: "Your session expired" })).toBeVisible();
  // The dead cookie was cleared, so this is now an ordinary signed-out visit.
  expect((await context.cookies()).some((c) => c.name === "__Host-willy_session")).toBe(false);
  await page.getByRole("link", { name: "Sign in again" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("unknown pages show the same not-found page whoever asks", async ({ page }) => {
  await signIn(page, "ada@example.test");
  const response = await page.goto("/meetings/does-not-exist-or-belongs-to-someone-else");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
});

test("API paths answer 401 JSON instead of redirecting", async ({ request }) => {
  const res = await request.get("/api/meetings/x/status", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
});

test("repeated failed sign-ins are rate limited with a retry hint", async ({ page }, testInfo) => {
  const email = `ratelimit-${testInfo.project.name}@example.test`;
  for (let i = 0; i < 5; i++) await signIn(page, email, "bad-password");
  await signIn(page, email, "bad-password");
  await expect(page.getByRole("alert")).toContainText("Too many attempts");
});
