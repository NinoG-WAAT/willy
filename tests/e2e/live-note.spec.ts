import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { countTranscribeJobs, meetingStatus } from "../support/e2e-db";
import { installFakeMicrophone } from "../support/fake-microphone";

const PASSWORD = "willy-dev-password";

test.beforeEach(async ({ page }) => {
  await installFakeMicrophone(page);
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

function unique(label: string, info: TestInfo): string {
  return `${label} ${info.project.name} ${String(info.workerIndex)} ${String(Date.now())}`;
}

/** Creates a note through the real form and opens it. Returns the meeting id. */
async function openNewNote(page: Page, title: string): Promise<string> {
  await page.goto("/meetings/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill("2030-05-14");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("Attendees (optional)").fill("Grace Hopper <grace@example.com>");
  await page.getByLabel("Agenda (optional)").fill("Roadmap review");
  await page.getByRole("button", { name: "Create note" }).click();
  await page.getByRole("link", { name: new RegExp(`Start note for ${title}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop();
  if (!id) throw new Error("meeting id not found in the URL");
  return id;
}

async function startCapture(page: Page): Promise<void> {
  await page.getByLabel(/I have told every participant/).check();
  await page.getByRole("button", { name: "Start capture" }).click();
}

const banner = (page: Page) => page.locator("#rec-banner");

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("the live note belongs to its owner: another owner's id and a guessed id are plain 404s", async ({
  page,
}, info) => {
  await signIn(page, "ada@example.test");
  const id = await openNewNote(page, unique("Private", info));
  const csrf = (await page.locator("#live-note").getAttribute("data-csrf")) ?? "";
  const origin = new URL(page.url()).origin;

  expect((await page.goto("/meetings/meeting-b-published"))?.status()).toBe(404);
  expect((await page.goto("/meetings/does-not-exist"))?.status()).toBe(404);

  // The autosave endpoint and the status endpoint are owner-scoped too.
  const headers = { "X-CSRF-Token": csrf, Origin: origin, "Content-Type": "application/json" };
  const foreign = await page.request.post("/api/meetings/meeting-b-published/notes", {
    headers,
    data: { roughNotes: "hijack" },
  });
  expect(foreign.status()).toBe(404);
  expect((await page.request.get("/api/meetings/meeting-b-published/status")).status()).toBe(404);
  const own = await page.request.post(`/api/meetings/${id}/notes`, {
    headers,
    data: { roughNotes: "mine" },
  });
  expect(own.status()).toBe(200);
});

test.describe("journey 1: consent, capture, rough notes, recording state until stop", () => {
  test("capture stays disabled until consent is ticked; then a persistent recording state shows until stop, which queues exactly one job", async ({
    page,
  }, info) => {
    await signIn(page, "ada@example.test");
    const title = unique("Customer call", info);
    const id = await openNewNote(page, title);
    await expect(page).toHaveTitle(`${title} - Willycrumbs`);
    await noHorizontalScroll(page);
    await expect(page.getByText("Grace Hopper")).toBeVisible();
    await expect(page.getByText("Roadmap review")).toBeVisible();

    // Consent gate: disabled until the owner ticks the statement.
    const start = page.getByRole("button", { name: "Start capture" });
    await expect(start).toBeDisabled();
    await expect(banner(page)).toHaveCount(0);
    await page.getByLabel(/I have told every participant/).check();
    await expect(start).toBeEnabled();
    const box = await start.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await start.click();

    // Unmistakable, persistent recording state: text, a shape and a live timer.
    await expect(banner(page)).toBeVisible();
    await expect(page.locator("#rec-label")).toHaveText("Recording");
    await expect(page.locator("#rec-detail")).toContainText("microphone is on in this browser");
    await expect(page.locator("#level")).toBeVisible();
    await expect.poll(async () => page.locator("#rec-timer").textContent()).not.toBe("00:00:00");
    await expect(page.locator("#upload-status")).toHaveText(
      /All recorded audio is uploaded|Uploading audio/,
    );
    await expect(page.locator("#upload-status")).toHaveText("All recorded audio is uploaded.", {
      timeout: 15_000,
    });
    expect(meetingStatus(id)).toBe("capturing");
    await noHorizontalScroll(page);

    // A reload does not lose the state: still recording, still visible.
    await page.reload();
    await expect(page.locator("#rec-label")).toHaveText("Recording");
    await expect(page.locator("#rec-detail")).toContainText("microphone is on in this browser");

    // Rough notes are editable and autosaved while recording.
    await page
      .getByLabel("Your notes (saved as you type)")
      .fill("Decision: ship the beta in November");
    await expect(page.locator("#notes-status")).toContainText("Saved at");

    // The banner follows the owner while they scroll.
    expect(await banner(page).evaluate((el) => getComputedStyle(el).position)).toBe("sticky");

    // Stop: exactly one transcription job, even if the form is submitted again.
    await page.getByRole("button", { name: "Stop capture" }).click();
    await expect(
      page.getByText("Recording finished. Preparing the transcript.").first(),
    ).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    expect(meetingStatus(id)).toBe("processing");
    expect(countTranscribeJobs(id)).toBe(1);
    const status = await page.request.get(`/api/meetings/${id}/status`);
    expect((await status.json()) as { job: { status: string } | null }).toMatchObject({
      job: { status: "pending" },
    });

    // The rough note survived, and is still editable after capture.
    await page.reload();
    await expect(page.getByLabel("Your notes (saved as you type)")).toHaveValue(
      "Decision: ship the beta in November",
    );
    expect(countTranscribeJobs(id)).toBe(1);
  });

  test("pause shows a different but still unmistakable state; resume continues; both are server state", async ({
    page,
  }, info) => {
    await signIn(page, "ada@example.test");
    const id = await openNewNote(page, unique("Pause test", info));
    await startCapture(page);
    await expect(page.locator("#rec-label")).toHaveText("Recording");

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.locator("#rec-label")).toHaveText("Recording paused");
    await expect(page.locator("#rec-detail")).toContainText("Nothing is being recorded");
    await expect(banner(page)).toHaveAttribute("data-state", "paused");
    expect(meetingStatus(id)).toBe("paused");

    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.locator("#rec-label")).toHaveText("Recording");
    await expect(page.locator("#rec-detail")).toContainText("microphone is on in this browser");
    expect(meetingStatus(id)).toBe("capturing");

    await page.getByRole("button", { name: "Stop capture" }).click();
    await expect(banner(page)).toHaveCount(0);
    expect(countTranscribeJobs(id)).toBe(1);
  });

  test("rough notes autosave, survive a refresh, and can be saved with a plain form too", async ({
    page,
  }, info) => {
    await signIn(page, "ada@example.test");
    await openNewNote(page, unique("Notes test", info));
    const notes = page.getByLabel("Your notes (saved as you type)");
    await notes.fill("first line\n\n  - indented point");
    await expect(page.locator("#notes-status")).toContainText("Saved at");
    await page.reload();
    await expect(notes).toHaveValue("first line\n\n  - indented point");

    await notes.fill("edited by form");
    await page.getByRole("button", { name: "Save notes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Notes saved." })).toBeVisible();
    await expect(notes).toHaveValue("edited by form");
  });
});

test.describe("capture failure recovery", () => {
  test("a blocked microphone is explained, notes still work, capture can be stopped", async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("blocked", "NotAllowedError"));
    });
    await signIn(page, "ada@example.test");
    const id = await openNewNote(page, unique("Mic denied", info));
    await startCapture(page);

    const problem = page.locator("#capture-problem");
    await expect(problem).toBeVisible();
    await expect(problem).toContainText("Microphone access was blocked");
    await expect(page.locator("#rec-detail")).toContainText("Not recording in this browser");
    await expect(page.getByRole("button", { name: "Try the microphone again" })).toBeVisible();

    // Notes are unaffected by the failure.
    await page.getByLabel("Your notes (saved as you type)").fill("still typing");
    await expect(page.locator("#notes-status")).toContainText("Saved at");

    // The owner can give up cleanly; one job is queued.
    await page.getByRole("button", { name: "Stop capture" }).click();
    await expect(banner(page)).toHaveCount(0);
    expect(meetingStatus(id)).toBe("processing");
    expect(countTranscribeJobs(id)).toBe(1);
  });

  test("uploads that fail are retried automatically and nothing is lost", async ({
    page,
  }, info) => {
    let failures = 0;
    await page.route("**/api/meetings/*/chunks*", async (route) => {
      if (failures < 3) {
        failures += 1;
        await route.abort("connectionfailed");
      } else {
        await route.continue();
      }
    });
    await signIn(page, "ada@example.test");
    await openNewNote(page, unique("Flaky network", info));
    await startCapture(page);
    await expect(page.locator("#upload-status")).toHaveText("All recorded audio is uploaded.", {
      timeout: 20_000,
    });
    expect(failures).toBe(3);
    await page.getByRole("button", { name: "Stop capture" }).click();
    await expect(banner(page)).toHaveCount(0);
  });

  test("when uploads keep failing the owner is told, can retry, and is warned before stopping", async ({
    page,
  }, info) => {
    test.slow();
    test.skip(info.project.name !== "desktop", "slow retry timing is checked once");
    let offline = true;
    await page.route("**/api/meetings/*/chunks*", async (route) => {
      if (offline) await route.abort("connectionfailed");
      else await route.continue();
    });
    await signIn(page, "ada@example.test");
    const id = await openNewNote(page, unique("Offline", info));
    await startCapture(page);

    const problem = page.locator("#capture-problem");
    await expect(problem).toContainText("Audio is waiting to upload", { timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Retry upload" })).toBeVisible();
    await expect(page.locator("#upload-status")).toContainText("Upload problem");

    // Stopping now would lose audio: the owner is warned instead of losing it silently.
    await page.getByRole("button", { name: "Stop capture" }).click();
    await expect(problem).toContainText("not uploaded yet");
    await expect(page.getByRole("button", { name: "Stop anyway" })).toBeVisible();
    expect(meetingStatus(id)).toBe("capturing");

    // Connection is back: retry uploads everything, then the stop goes through.
    offline = false;
    await page.getByRole("button", { name: "Retry upload" }).click();
    await expect(
      page.getByText("Recording finished. Preparing the transcript.").first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    expect(countTranscribeJobs(id)).toBe(1);
  });
});

test.describe("server-side consent and no-JavaScript path", () => {
  test.use({ javaScriptEnabled: false });

  test("the server refuses to start capture without the consent tick, then works with it", async ({
    page,
  }, info) => {
    await signIn(page, "ada@example.test");
    const id = await openNewNote(page, unique("No JS", info));

    // Without JavaScript the button is enabled, so only the server stands in the way.
    await page.getByRole("button", { name: "Start capture" }).click();
    await expect(page.getByRole("alert")).toContainText("Tick the consent statement first");
    expect(meetingStatus(id)).toBe("scheduled");
    await expect(banner(page)).toHaveCount(0);

    await page.getByLabel(/I have told every participant/).check();
    await page.getByRole("button", { name: "Start capture" }).click();
    await expect(page.locator("#rec-label")).toHaveText("Recording");
    await expect(page.getByText(/Audio capture needs JavaScript/).first()).toBeVisible();
    expect(meetingStatus(id)).toBe("capturing");

    await page.getByLabel("Your notes (saved as you type)").fill("typed without JS");
    await page.getByRole("button", { name: "Save notes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Notes saved." })).toBeVisible();

    await page.getByRole("button", { name: "Stop capture" }).click();
    await expect(
      page.getByText("Recording finished. Preparing the transcript.").first(),
    ).toBeVisible();
    expect(countTranscribeJobs(id)).toBe(1);
  });
});
