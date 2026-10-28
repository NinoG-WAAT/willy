import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "willy-dev-password";

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

test("every response carries a request id, and a sane inbound one is kept", async ({ request }) => {
  const generated = await request.get("/healthz");
  expect(generated.headers()["x-request-id"]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  const kept = await request.get("/healthz", { headers: { "x-request-id": "trace-abc-123456" } });
  expect(kept.headers()["x-request-id"]).toBe("trace-abc-123456");
  const forged = await request.get("/healthz", { headers: { "x-request-id": "bad id" } });
  expect(forged.headers()["x-request-id"]).not.toBe("bad id");
});

test("/healthz stays status-only", async ({ request }) => {
  const res = await request.get("/healthz");
  expect(await res.json()).toEqual({ status: "ok" });
});

test("diagnostics need a session", async ({ request }) => {
  const res = await request.get("/diagnostics", { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toContain("/sign-in");
});

test("diagnostics show migration, the owner's job counts and provider modes, nothing sensitive", async ({
  page,
}) => {
  await signIn(page, "ada@example.test");
  const res = await page.request.get("/diagnostics");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  const body = (await res.json()) as {
    migration: { latest: string };
    jobs: Record<string, number>;
    providers: Record<string, string>;
  };
  expect(body.migration.latest).toMatch(/^\d{4}$/);
  expect(Object.keys(body.jobs).sort()).toEqual([
    "failed",
    "pending",
    "retrying",
    "running",
    "succeeded",
  ]);
  expect(body.providers).toEqual({
    speechToText: "fake",
    summaries: "fake",
    calendar: "fake",
    storage: "local",
  });
  expect(JSON.stringify(body)).not.toMatch(/secret|key|token|password|@example/i);
});

test("unexpected pages answer 404 with a request id header", async ({ page }) => {
  await signIn(page, "ada@example.test");
  const res = await page.request.get("/meetings/does-not-exist-123");
  expect(res.status()).toBe(404);
  expect(res.headers()["x-request-id"]).toBeTruthy();
});
