import { expect, test, type Page } from "@playwright/test";
import { createCapturingMeeting } from "../support/e2e-db";

const PASSWORD = "willy-dev-password";

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  return (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
}

test("the status endpoint needs a session", async ({ request }) => {
  const res = await request.get("/api/meetings/anything/status", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});

test("an owner sees status, job and chunk counts for their own meeting", async ({ page }) => {
  const token = await signIn(page, "ada@example.test");
  const meetingId = createCapturingMeeting("owner-ada");
  const before = await page.request.get(`/api/meetings/${meetingId}/status`);
  expect(before.status()).toBe(200);
  expect(before.headers()["cache-control"]).toBe("no-store");
  expect(await before.json()).toEqual({
    meetingStatus: "capturing",
    job: null,
    chunks: { total: 0, uploaded: 0, transcribed: 0, failed: 0, purged: 0 },
  });

  const origin = new URL(page.url()).origin;
  const upload = await page.request.post(`/api/meetings/${meetingId}/chunks?seq=0`, {
    headers: { origin, "x-csrf-token": token, "content-type": "audio/webm" },
    data: Buffer.from("RIFF-status-audio"),
  });
  expect(upload.status()).toBe(201);
  const after = await page.request.get(`/api/meetings/${meetingId}/status`);
  expect((await after.json()) as unknown).toMatchObject({
    chunks: { total: 1, uploaded: 1 },
  });
});

test("another owner's meeting looks exactly like one that does not exist", async ({ page }) => {
  await signIn(page, "ben@example.test");
  const adasMeeting = createCapturingMeeting("owner-ada");
  const foreign = await page.request.get(`/api/meetings/${adasMeeting}/status`);
  const unknown = await page.request.get("/api/meetings/does-not-exist/status");
  expect(foreign.status()).toBe(404);
  expect(unknown.status()).toBe(404);
  expect(await foreign.json()).toEqual(await unknown.json());
});

test("the job-run endpoint needs a session and CSRF token, and exists only when enabled", async ({
  page,
  request,
}) => {
  const anonymous = await request.post("/internal/jobs/run", { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  const token = await signIn(page, "ada@example.test");
  const origin = new URL(page.url()).origin;
  const noToken = await page.request.post("/internal/jobs/run", { headers: { origin } });
  expect(noToken.status()).toBe(403);
  const ok = await page.request.post("/internal/jobs/run", {
    headers: { origin, "x-csrf-token": token },
  });
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as { ran: unknown };
  expect(typeof body.ran).toBe("number");
});
