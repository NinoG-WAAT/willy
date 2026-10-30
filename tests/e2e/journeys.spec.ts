import { readFile } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { createCapturingMeeting, createReviewMeeting, meetingStatus } from "../support/e2e-db";
import { installFakeMicrophone } from "../support/fake-microphone";
import {
  DEV_PASSWORD,
  createFreshOwner,
  meetingFootprint,
  storedAudioFiles,
  type FreshOwner,
} from "../support/journey-db";

// The three journeys of product.md, each as one flow through the real interface and the real
// server pipeline (fake microphone, speech-to-text and summary providers). Every test owns a
// fresh owner, so its searches, folders and jobs cannot be touched by tests running in parallel,
// and "run my jobs" only ever advances this test's own work. All of them run on the desktop and
// the 390x844 phone project.

const DEMO_EVENT = "Customer call with Grace (demo)";

// Each journey drives real capture, uploads, background jobs and several page loads, and the
// suite runs many browsers at once on small CI machines: give waits on state more room than the
// 5 s default instead of ever sleeping.
const expect = baseExpect.configure({ timeout: 15_000 });
test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  await installFakeMicrophone(page);
});

/** Signs in through the form and returns the session's CSRF token. */
async function signIn(page: Page, owner: Pick<FreshOwner, "email">): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  return (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

function meetingIdFromUrl(page: Page): string {
  const id = new URL(page.url()).pathname.split("/")[2];
  if (!id) throw new Error("meeting id not found in the URL");
  return id;
}

/** Creates a note through the New note form and opens its live note. Returns the meeting id. */
async function createAndOpenNote(page: Page, title: string): Promise<string> {
  await page.goto("/meetings/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill("2030-05-14");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("Attendees (optional)").fill("Grace Hopper <grace@example.com>");
  await page.getByRole("button", { name: "Create note" }).click();
  await page.getByRole("link", { name: `Start note for ${title}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return meetingIdFromUrl(page);
}

/** Ticks consent, starts capture and waits until the server holds at least one audio chunk. */
async function startCaptureAndWaitForAudio(page: Page, meetingId: string): Promise<void> {
  await page.getByLabel(/I have told every participant/).check();
  await page.getByRole("button", { name: "Start capture" }).click();
  await expect(page.locator("#rec-label")).toHaveText("Recording");
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/meetings/${meetingId}/status`);
        const body = (await response.json()) as { chunks: { uploaded: number } };
        return body.chunks.uploaded;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

async function stopCapture(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Stop capture" }).click();
  await expect(
    page.getByText("Recording finished. Preparing the transcript.").first(),
  ).toBeVisible();
  await expect(page.locator("#rec-banner")).toHaveCount(0);
}

/**
 * Runs this owner's due jobs until the meeting reaches a status. The background runner is off in
 * tests, so this is the only thing that advances the work, and it only touches this owner's jobs.
 */
async function runJobsUntil(
  page: Page,
  token: string,
  meetingId: string,
  status: string,
): Promise<void> {
  const origin = new URL(page.url()).origin;
  await expect
    .poll(
      async () => {
        const run = await page.request.post("/internal/jobs/run", {
          headers: { origin, "x-csrf-token": token },
        });
        expect(run.status()).toBe(200);
        return meetingStatus(meetingId);
      },
      { timeout: 30_000 },
    )
    .toBe(status);
}

test.describe("journey 1: import, consent, capture, rough notes, recording state until stop", () => {
  test("starts from an imported calendar event and stays visibly recording until stopped", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    await signIn(page, owner);

    // Import: the demo calendar offers events; the owner picks one from the list.
    await page.getByRole("button", { name: "Import from calendar" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Imported/ })).toContainText(
      "Imported 2 new meetings.",
    );
    const card = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { level: 3, name: DEMO_EVENT }) });
    await expect(card).toContainText("From your calendar");
    await expect(card).toContainText("Scheduled");
    await expect(card).toContainText("Your consent confirmation is still needed before capture");
    await noHorizontalScroll(page);
    await card.getByRole("link", { name: `Start note for ${DEMO_EVENT}` }).click();

    // The live note shows who is expected, and capture is closed until the owner confirms consent.
    await expect(page.getByRole("heading", { level: 1, name: DEMO_EVENT })).toBeVisible();
    const id = meetingIdFromUrl(page);
    await expect(page.getByText("Grace Hopper")).toBeVisible();
    const start = page.getByRole("button", { name: "Start capture" });
    await expect(start).toBeDisabled();
    await expect(page.locator("#rec-banner")).toHaveCount(0);
    expect(meetingStatus(id)).toBe("scheduled");

    await startCaptureAndWaitForAudio(page, id);
    await expect(page.locator("#rec-banner")).toBeVisible();
    await expect(page.locator("#rec-detail")).toContainText("microphone is on in this browser");
    expect(meetingStatus(id)).toBe("capturing");
    await noHorizontalScroll(page);

    // Rough notes while recording, and the recording state survives a refresh.
    await page.getByLabel("Your notes (saved as you type)").fill("Grace wants the November beta");
    await expect(page.locator("#notes-status")).toContainText("Saved at");
    await page.reload();
    await expect(page.locator("#rec-label")).toHaveText("Recording");
    await expect(page.getByLabel("Your notes (saved as you type)")).toHaveValue(
      "Grace wants the November beta",
    );

    // The recording state ends only when the owner stops: one job, notes intact.
    await stopCapture(page);
    expect(meetingStatus(id)).toBe("processing");
    await page.reload();
    await expect(page.getByLabel("Your notes (saved as you type)")).toHaveValue(
      "Grace wants the November beta",
    );
    await page.goto("/");
    await expect(card).toContainText("Processing");
  });
});

test.describe("journey 2: review the transcript-backed summary and publish to a private folder", () => {
  test("a real capture becomes a draft that the owner corrects, edits and publishes", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    const token = await signIn(page, owner);

    // A private folder to publish into.
    await page.goto("/folders");
    await page.getByLabel("Folder name", { exact: true }).fill("Board updates");
    await page.getByRole("button", { name: "Create folder" }).click();
    await expect(page.getByRole("status")).toHaveText("Folder created.");

    // Capture a short meeting, then let the pipeline (transcription, summary) run.
    const id = await createAndOpenNote(page, "Roadmap sync");
    await startCaptureAndWaitForAudio(page, id);
    await stopCapture(page);
    await runJobsUntil(page, token, id, "review");

    // The home card now points at the review.
    await page.goto("/");
    await page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { level: 3, name: "Roadmap sync" }) })
      .getByRole("link", { name: "Review note for Roadmap sync" })
      .click();
    await expect(page).toHaveURL(`/meetings/${id}/review`);
    await expect(page.locator("#note-status")).toHaveText("Draft");
    await noHorizontalScroll(page);

    // Transcript-backed: every summary section cites transcript lines, and following the link
    // marks exactly those lines.
    const lines = page.locator(".transcript li");
    await expect(lines.first()).toContainText("Fake transcript for");
    await expect(page.locator(".transcript li.is-source")).toHaveCount(0);
    await page
      .locator("#summary")
      .getByRole("link", { name: /Source: transcript/ })
      .first()
      .click();
    expect(await page.locator(".transcript li.is-source").count()).toBeGreaterThan(0);

    // Correct a speaker: every line of that speaker changes.
    const speakers = page.getByLabel("Speaker to rename");
    await speakers.selectOption({ index: 1 });
    await page.getByLabel("New name").fill("Grace Hopper");
    await page.getByRole("button", { name: "Rename speaker" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Speaker renamed" })).toBeVisible();
    expect(
      await page.locator(".transcript li", { hasText: "Grace Hopper" }).count(),
    ).toBeGreaterThan(0);

    // Edit the summary: a person's words replace the draft.
    await page
      .getByLabel(/^Text of/)
      .first()
      .fill("We agreed to ship the beta in November.");
    await page
      .getByRole("button", { name: /^Save section/ })
      .first()
      .click();
    await expect(page.getByText("We agreed to ship the beta in November.").first()).toBeVisible();

    // Publishing is explicit and confirmed; the note lands in the private folder.
    await page.getByLabel("Private folder").selectOption({ label: "Board updates" });
    await page.getByLabel("I have reviewed this note and want to publish it.").check();
    await page.getByRole("button", { name: "Publish to folder" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Published." })).toBeVisible();
    await page.reload();
    await expect(page.locator("#note-status")).toHaveText("Published");
    await expect(page.locator("#publish")).toContainText("Board updates");
    await expect(page.getByText("We agreed to ship the beta in November.").first()).toBeVisible();
    expect(meetingStatus(id)).toBe("published");

    // And All notes, filtered by the folder chip, finds it (published notes left the Inbox).
    await page.goto("/notes");
    await page
      .getByRole("navigation", { name: "Filter by folder" })
      .getByRole("link", { name: "Board updates" })
      .click();
    await expect(page.getByRole("heading", { level: 3, name: "Roadmap sync" })).toBeVisible();
  });
});

test.describe("live note to review (#63, #66)", () => {
  // Issue #66: nobody is typing after Stop, so once the pipeline has run the draft opens by itself.
  test("after Stop the draft opens by itself when the owner is idle", async ({ page }) => {
    const owner = createFreshOwner();
    const token = await signIn(page, owner);
    const id = await createAndOpenNote(page, "Idle hand-off");
    await startCaptureAndWaitForAudio(page, id);
    await stopCapture(page);
    // Real counts from the real chunk rows (the fake speech-to-text has not run yet).
    await expect(page.locator('#processing-progress [data-field="transcribe"]')).toHaveText(
      /^Transcribing: 0 of [1-9]\d* parts?$/,
    );

    await runJobsUntil(page, token, id, "review");
    await expect(page).toHaveURL(`/meetings/${id}/review`, { timeout: 45_000 });
    await expect(page.locator("#note-status")).toHaveText("Draft");
  });

  test("after Stop, with the cursor in the notes, the page offers the draft with no reload, and the link opens the review", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    const token = await signIn(page, owner);
    const id = await createAndOpenNote(page, "Link to the draft");
    await startCaptureAndWaitForAudio(page, id);
    await stopCapture(page);
    // The owner is writing: the draft must not open under the cursor.
    await page.getByLabel("Your notes (saved as you type)").click();
    // A marker a reload would remove: the link has to show up in this very document.
    await page.evaluate(() => {
      (window as unknown as { sameDocument: boolean }).sameDocument = true;
    });
    const link = page.getByRole("link", { name: "Open the draft" });
    await expect(link).toBeHidden();

    // The pipeline (fake speech-to-text and summary) runs; the page is only polling.
    await runJobsUntil(page, token, id, "review");
    await expect(link).toBeVisible({ timeout: 45_000 });
    await expect(link).toHaveAttribute("href", `/meetings/${id}/review`);
    expect(
      await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument),
    ).toBe(true);
    await noHorizontalScroll(page);

    await link.click();
    await expect(page).toHaveURL(`/meetings/${id}/review`);
    await expect(page.locator("#note-status")).toHaveText("Draft");
  });
});

test.describe("journey 3: search, open with context, export, permanently delete", () => {
  test("finds an old meeting, exports it, deletes it, and nothing of it is left", async ({
    page,
    browser,
  }) => {
    const owner = createFreshOwner();
    const token = await signIn(page, owner);
    const word = "lighthouse";

    // An old meeting that keeps its raw audio for a day after transcription (so a real audio
    // file exists when the deletion happens), with a transcript, a summary and rough notes.
    await page.goto("/settings");
    await page.getByLabel("Raw audio").selectOption("24");
    await page.getByRole("button", { name: "Save retention" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Retention settings saved." }),
    ).toBeVisible();
    const title = "Old board prep";
    const id = await createAndOpenNote(page, title);
    await startCaptureAndWaitForAudio(page, id);
    await page.getByLabel("Your notes (saved as you type)").fill(`${word} pricing was the topic`);
    await expect(page.locator("#notes-status")).toContainText("Saved at");
    await stopCapture(page);
    await runJobsUntil(page, token, id, "review");

    const before = meetingFootprint(id);
    expect(before.chunks).toBeGreaterThan(0);
    expect(before.transcriptSegments).toBeGreaterThan(0);
    expect(before.notes).toBe(1);
    expect(before.searchRows).toBeGreaterThan(0);
    expect(storedAudioFiles(owner.id, id).length).toBeGreaterThan(0);

    // Search: the owner's own words are found and highlighted in the snippet.
    await page.goto("/");
    await page.getByRole("search").getByLabel("Search your notes").fill(word);
    await page.getByRole("search").getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("status").filter({ hasText: "result" })).toContainText(
      `1 result for "${word}"`,
    );
    const roughHit = page.getByRole("listitem").filter({ hasText: title });
    await expect(roughHit.locator("mark").first()).toHaveText(word);
    await noHorizontalScroll(page);

    // The summary is searchable too: opening that hit marks the matching section and the
    // transcript lines it cites (the source context).
    await page.goto(`/search?q=${encodeURIComponent("transcript segments")}`);
    await page
      .getByRole("listitem")
      .filter({ hasText: title })
      .getByRole("link", { name: /^Open/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/meetings/${id}/review\\?`));
    await expect(page.getByText("Search match")).toBeVisible();
    expect(await page.locator(".transcript li.is-source").count()).toBeGreaterThan(0);

    // Export to Markdown from the search result.
    await page.goto(`/search?q=${word}`);
    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: /^Export Markdown/ }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.md$/);
    const downloadedPath = await download.path();
    const markdown = await readFile(downloadedPath, "utf8");
    expect(markdown).toContain(`# ${title}`);
    expect(markdown).toContain(`${word} pricing was the topic`);

    // Permanent deletion: scope, typed confirmation, then the job.
    await page.goto("/settings");
    await page
      .getByRole("region", { name: "Permanent deletion" })
      .locator(`a[href="/meetings/${id}/delete"]`)
      .click();
    await expect(page.getByRole("region", { name: "What will be destroyed" })).toContainText(
      "audio",
    );
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page).toHaveURL(/\/settings\?notice=deletion_requested/);

    // Hidden at once, before the job has run: every surface answers 404 for the owner.
    for (const path of [
      `/meetings/${id}`,
      `/meetings/${id}/review`,
      `/meetings/${id}/export.md`,
      `/api/meetings/${id}/status`,
    ]) {
      expect((await page.request.get(path)).status(), path).toBe(404);
    }
    await page.goto(`/search?q=${word}`);
    await expect(page.getByText(`No results for "${word}"`)).toBeVisible();

    // The job removes the files and the derived data.
    await expect
      .poll(
        async () => {
          const run = await page.request.post("/internal/jobs/run", {
            headers: { origin: new URL(page.url()).origin, "x-csrf-token": token },
          });
          expect(run.status()).toBe(200);
          return meetingStatus(id);
        },
        { timeout: 30_000 },
      )
      .toBe("deleted");
    expect(storedAudioFiles(owner.id, id)).toEqual([]);
    expect(meetingFootprint(id)).toMatchObject({
      chunks: 0,
      transcriptSegments: 0,
      notes: 0,
      searchRows: 0,
    });
    await page.goto(`/search?q=${encodeURIComponent("transcript segments")}`);
    await expect(page.getByText(/No results for/)).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("listitem").filter({ hasText: id })).toContainText("Deleted");

    // Still gone, for the owner and for a guessed chunk URL, after the job finished.
    expect((await page.request.get(`/meetings/${id}`)).status()).toBe(404);
    const guessedUpload = await page.request.post(`/api/meetings/${id}/chunks?seq=0`, {
      headers: {
        origin: new URL(page.url()).origin,
        "x-csrf-token": token,
        "content-type": "audio/webm",
      },
      data: Buffer.from("RIFF-after-deletion"),
    });
    expect(guessedUpload.status()).toBe(404);
    expect(storedAudioFiles(owner.id, id)).toEqual([]);

    // Another owner cannot get at it either, by id or by searching for its words.
    const other = createFreshOwner();
    const otherPage = await browser.newPage();
    await signIn(otherPage, other);
    expect((await otherPage.request.get(`/meetings/${id}/export.md`)).status()).toBe(404);
    await otherPage.goto(`/search?q=${word}`);
    await expect(otherPage.getByText(`No results for "${word}"`)).toBeVisible();
    await otherPage.close();
  });
});

test.describe("permission boundaries: another owner gets the same answer as for an unknown id", () => {
  test("owner B cannot read or change owner A's meeting through any page, form or endpoint", async ({
    page,
    browser,
  }) => {
    // Owner A has a live capture with rough notes, a reviewed note and a searchable note.
    const ownerA = createFreshOwner();
    const pageA = await browser.newPage();
    await installFakeMicrophone(pageA);
    await signIn(pageA, ownerA);
    const liveId = await createAndOpenNote(pageA, "Secret acquisition talks");
    await pageA.getByLabel("Your notes (saved as you type)").fill("zephyrword is the code name");
    await expect(pageA.locator("#notes-status")).toContainText("Saved at");
    const reviewId = await createReviewMeeting(ownerA.id);
    const scheduledId = createCapturingMeeting(ownerA.id, "scheduled", "A private plan");
    const baseline = {
      live: meetingStatus(liveId),
      review: meetingStatus(reviewId),
      scheduled: meetingStatus(scheduledId),
      footprint: meetingFootprint(liveId),
    };

    // Positive control: A really can open all of these, so a 404 for B means something.
    for (const path of [
      `/meetings/${liveId}`,
      `/meetings/${reviewId}/review`,
      `/meetings/${reviewId}/export.md`,
      `/api/meetings/${liveId}/status`,
    ]) {
      expect((await pageA.request.get(path)).status(), `A ${path}`).toBe(200);
    }

    const ownerB = createFreshOwner();
    const token = await signIn(page, ownerB);
    const origin = new URL(page.url()).origin;
    const headers = { origin, "x-csrf-token": token };
    const unknown = "never-existed";

    type Probe = { name: string; run: (id: string) => Promise<{ status: number; body: string }> };
    const reply = async (
      response: Awaited<ReturnType<typeof page.request.get>>,
    ): Promise<{ status: number; body: string }> => ({
      status: response.status(),
      body: await response.text(),
    });
    const get = (path: (id: string) => string) => (id: string) =>
      page.request.get(path(id)).then(reply);
    const postForm = (path: (id: string) => string, form: Record<string, string>) => (id: string) =>
      page.request.post(path(id), { headers, form }).then(reply);
    const probes: Probe[] = [
      { name: "live note page", run: get((id) => `/meetings/${id}`) },
      { name: "review page", run: get((id) => `/meetings/${id}/review`) },
      { name: "delete page", run: get((id) => `/meetings/${id}/delete`) },
      { name: "Markdown export", run: get((id) => `/meetings/${id}/export.md`) },
      { name: "status endpoint", run: get((id) => `/api/meetings/${id}/status`) },
      {
        name: "start capture form",
        run: postForm((id) => `/meetings/${id}`, { intent: "start", consent: "on" }),
      },
      {
        name: "save rough notes form",
        run: postForm((id) => `/meetings/${id}`, { intent: "save_notes", rough_notes: "hijack" }),
      },
      {
        name: "autosave endpoint",
        run: (id) =>
          page.request
            .post(`/api/meetings/${id}/notes`, {
              headers: { ...headers, "content-type": "application/json" },
              data: { roughNotes: "hijack" },
            })
            .then(reply),
      },
      {
        name: "audio chunk upload",
        run: (id) =>
          page.request
            .post(`/api/meetings/${id}/chunks?seq=0`, {
              headers: { ...headers, "content-type": "audio/webm" },
              data: Buffer.from("RIFF-not-yours"),
            })
            .then(reply),
      },
      {
        name: "review edit form",
        run: postForm((id) => `/meetings/${id}/review`, {
          intent: "edit_decision",
          id: `${reviewId}-dec-0`,
          text: "hijack",
        }),
      },
      {
        name: "publish form",
        run: postForm((id) => `/meetings/${id}/review`, {
          intent: "publish",
          folder: `folder-${reviewId}`,
          confirm: "on",
        }),
      },
      {
        name: "regenerate a section",
        run: postForm((id) => `/meetings/${id}/note/regenerate`, {
          section_id: `${reviewId}-sec-0`,
        }),
      },
      {
        name: "permanent deletion",
        run: postForm((id) => `/meetings/${id}/delete`, { confirmation: "DELETE" }),
      },
      { name: "deletion retry", run: postForm((id) => `/settings/deletions/${id}/retry`, {}) },
    ];

    for (const targetId of [liveId, reviewId, scheduledId]) {
      for (const probe of probes) {
        const foreign = await probe.run(targetId);
        const guessed = await probe.run(unknown);
        expect(foreign.status, `${probe.name} on ${targetId}`).toBe(404);
        expect(foreign, `${probe.name} on ${targetId} differs from an unknown id`).toEqual(guessed);
        expect(foreign.body).not.toContain("Secret acquisition");
        expect(foreign.body).not.toContain("zephyrword");
      }
    }

    // Search and the home list never leak A's words or titles to B.
    await page.goto("/search?q=zephyrword");
    await expect(page.getByText('No results for "zephyrword"')).toBeVisible();
    await page.goto("/search?q=acquisition");
    await expect(page.getByText('No results for "acquisition"')).toBeVisible();
    await page.goto("/");
    await expect(page.locator("main")).not.toContainText("Secret acquisition");
    await expect(page.locator("main")).not.toContainText("A private plan");

    // Nothing of A's changed, and A still finds their own note.
    expect(meetingStatus(liveId)).toBe(baseline.live);
    expect(meetingStatus(reviewId)).toBe(baseline.review);
    expect(meetingStatus(scheduledId)).toBe(baseline.scheduled);
    expect(meetingFootprint(liveId)).toEqual(baseline.footprint);
    await pageA.goto("/search?q=zephyrword");
    await expect(pageA.getByRole("status").filter({ hasText: "result" })).toContainText(
      '1 result for "zephyrword"',
    );
    await pageA.close();
  });
});

test.describe("owner-supplied text on a small screen", () => {
  test("one very long word in a title wraps instead of scrolling the page sideways", async ({
    page,
  }) => {
    // A pasted URL or token is one unbreakable word; Linux fonts are wider than a developer's, so
    // this once overflowed only in CI (the unique words of the search tests had grown longer).
    const owner = createFreshOwner();
    createCapturingMeeting(owner.id, "scheduled", `Strategy ${"x".repeat(70)}`);
    await signIn(page, owner);
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/", "/settings", "/search?q=strategy"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await noHorizontalScroll(page);
    }
  });
});
