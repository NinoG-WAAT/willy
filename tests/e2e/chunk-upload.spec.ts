import { expect, test, type Page } from "@playwright/test";
import { createCapturingMeeting } from "../support/e2e-db";

const PASSWORD = "willy-dev-password";
const audio = Buffer.from("RIFF-e2e-audio-bytes");

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  const token = await page.locator("input[name=csrf_token]").first().getAttribute("value");
  expect(token).toBeTruthy();
  return token ?? "";
}

function upload(
  page: Page,
  meetingId: string,
  seq: number,
  headers: Record<string, string>,
  data: Buffer = audio,
) {
  return page.request.post(`/api/meetings/${meetingId}/chunks?seq=${String(seq)}`, {
    headers: { "content-type": "audio/webm", ...headers },
    data,
    maxRedirects: 0,
  });
}

test("anonymous callers get 401 JSON, not a redirect", async ({ request }) => {
  const res = await request.post("/api/meetings/anything/chunks?seq=0", {
    headers: { "content-type": "audio/webm" },
    data: audio,
    maxRedirects: 0,
  });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
});

test("uploads need the CSRF token and a same-origin Origin header", async ({ page }) => {
  const token = await signIn(page, "ada@example.test");
  const meetingId = createCapturingMeeting("owner-ada");
  const origin = new URL(page.url()).origin;
  expect((await upload(page, meetingId, 0, { origin })).status()).toBe(403);
  expect((await upload(page, meetingId, 0, { origin, "x-csrf-token": "forged" })).status()).toBe(
    403,
  );
  expect(
    (
      await upload(page, meetingId, 0, { origin: "https://evil.example", "x-csrf-token": token })
    ).status(),
  ).toBe(403);
});

test("an owner can upload a chunk, retries are idempotent, and bad uploads are refused", async ({
  page,
}) => {
  const token = await signIn(page, "ada@example.test");
  const meetingId = createCapturingMeeting("owner-ada");
  const origin = new URL(page.url()).origin;
  const headers = { origin, "x-csrf-token": token };

  const first = await upload(page, meetingId, 0, headers);
  expect(first.status()).toBe(201);
  expect(await first.json()).toEqual({ seq: 0, replay: false });

  const retry = await upload(page, meetingId, 0, headers);
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual({ seq: 0, replay: true });

  const different = await upload(page, meetingId, 0, headers, Buffer.from("other audio"));
  expect(different.status()).toBe(409);

  const wrongType = await page.request.post(`/api/meetings/${meetingId}/chunks?seq=1`, {
    headers: { ...headers, "content-type": "text/html" },
    data: audio,
  });
  expect(wrongType.status()).toBe(415);

  const tooBig = await upload(page, meetingId, 2, headers, Buffer.alloc(1_048_577));
  expect(tooBig.status()).toBe(413);
});

test("another owner's meeting looks exactly like one that does not exist", async ({ page }) => {
  const token = await signIn(page, "ben@example.test");
  const adasMeeting = createCapturingMeeting("owner-ada");
  const origin = new URL(page.url()).origin;
  const headers = { origin, "x-csrf-token": token };
  const foreign = await upload(page, adasMeeting, 0, headers);
  const unknown = await upload(page, "does-not-exist", 0, headers);
  expect(foreign.status()).toBe(404);
  expect(unknown.status()).toBe(404);
  expect(await foreign.json()).toEqual(await unknown.json());
});

test("uploads are refused unless the meeting is capturing or paused", async ({ page }) => {
  const token = await signIn(page, "ada@example.test");
  const scheduled = createCapturingMeeting("owner-ada", "scheduled");
  const origin = new URL(page.url()).origin;
  const res = await upload(page, scheduled, 0, { origin, "x-csrf-token": token });
  expect(res.status()).toBe(409);
  expect(await res.json()).toEqual({ error: "meeting_not_capturing" });
});
