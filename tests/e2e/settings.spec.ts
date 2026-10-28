import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createCapturingMeeting, createDeletionInState, meetingStatus } from "../support/e2e-db";

const PASSWORD = "willy-dev-password";

/** Signs in and returns the session's CSRF token (for requests made outside the page). */
async function signIn(page: Page, email: string): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  return (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
}

/** Unique per test, project and run: desktop and phone projects share one seeded database. */
function unique(label: string, info: TestInfo): string {
  return `${label} ${info.project.name} ${String(info.workerIndex)} ${String(Date.now())}`;
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

function deletionRow(page: Page, meetingId: string) {
  return page.getByRole("listitem").filter({ hasText: meetingId });
}

async function runJobs(page: Page, token: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.post("/internal/jobs/run", {
    headers: { origin, "x-csrf-token": token },
  });
  expect(res.status()).toBe(200);
}

test("signed-out visitors are sent to sign-in for settings, deletion and retry", async ({
  page,
  request,
}) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings$/);
  await page.goto("/meetings/anything/delete");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  const retry = await request.post("/settings/deletions/anything/retry", { maxRedirects: 0 });
  expect([302, 303, 401]).toContain(retry.status());
});

test.describe("overview and retention", () => {
  test("shows provider status, retention, template, export and deletion entry points", async ({
    page,
  }) => {
    await signIn(page, "ben@example.test");
    await page.goto("/settings");
    await expect(page).toHaveTitle("Settings - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await noHorizontalScroll(page);

    const providers = page.getByRole("region", { name: "Provider status" });
    for (const name of ["Calendar", "Speech-to-text", "Summaries (LLM)"]) {
      await expect(providers.getByRole("listitem").filter({ hasText: name })).toContainText(
        "Fake mode",
      );
    }
    await expect(
      providers.getByRole("listitem").filter({ hasText: "Audio storage" }),
    ).toContainText("Configured");
    // No secret-looking configuration names or values are ever rendered.
    await expect(page.locator("body")).not.toContainText(/API_KEY|SECRET|Bearer|sk-/);

    const retention = page.getByRole("region", { name: "Retention" });
    // The values themselves are owner-wide state that the retention test below changes.
    await expect(
      retention.getByRole("option", { name: /Delete right after successful transcription/ }),
    ).toHaveCount(1);
    await expect(retention.getByRole("option", { name: /until you delete them/ })).toHaveCount(1);

    await expect(page.getByRole("link", { name: "Edit templates" })).toHaveAttribute(
      "href",
      "/settings/templates",
    );
    await expect(page.getByRole("link", { name: "Manage folders" })).toHaveAttribute(
      "href",
      "/settings/folders",
    );
    const exportSection = page.getByRole("region", { name: "Export" });
    await expect(exportSection).toContainText("Markdown");
    await expect(
      exportSection.getByRole("link", { name: "Find a note to export" }),
    ).toHaveAttribute("href", "/search");
    await expect(page.getByRole("region", { name: "Permanent deletion" })).toBeVisible();
  });

  test("saves retention, keeps it after a refresh, and asks before notes start expiring", async ({
    page,
  }, info) => {
    // Retention is owner-wide state: run once, not per project, so the two never race.
    test.skip(info.project.name !== "desktop", "owner-wide state: desktop project only");
    await signIn(page, "ben@example.test");
    await page.goto("/settings");
    const retention = page.getByRole("region", { name: "Retention" });

    await retention.getByLabel("Raw audio").selectOption("72");
    await retention.getByRole("button", { name: "Save retention" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Retention settings saved." }),
    ).toBeVisible();
    await page.reload();
    await expect(retention.getByLabel("Raw audio")).toHaveValue("72");

    // Making notes expire deletes meetings automatically: it needs the explicit tick.
    await retention.getByLabel("Notes and transcripts").selectOption("365");
    await retention.getByRole("button", { name: "Save retention" }).click();
    await expect(page.locator(".field-error")).toContainText("Tick the box to confirm");
    await expect(retention.getByLabel("Notes and transcripts")).toHaveValue("365");
    await retention.getByLabel(/I understand/).check();
    await retention.getByRole("button", { name: "Save retention" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Retention settings saved." }),
    ).toBeVisible();
    await page.reload();
    await expect(retention.getByLabel("Notes and transcripts")).toHaveValue("365");

    // Back to the defaults (turning expiry off never needs the tick).
    await retention.getByLabel("Raw audio").selectOption("0");
    await retention.getByLabel("Notes and transcripts").selectOption("off");
    await retention.getByRole("button", { name: "Save retention" }).click();
    await page.reload();
    await expect(retention.getByLabel("Raw audio")).toHaveValue("0");
    await expect(retention.getByLabel("Notes and transcripts")).toHaveValue("off");
  });
});

test.describe("permanent deletion (journey 3)", () => {
  test("states the scope, requires the typed word, then shows the job until the meeting is gone", async ({
    page,
  }, info) => {
    const title = unique("Old board prep", info);
    const meetingId = createCapturingMeeting("owner-ada", "scheduled", title);
    const token = await signIn(page, "ada@example.test");

    // Settings lists the meeting with its deletion entry point.
    await page.goto("/settings");
    const deleteSection = page.getByRole("region", { name: "Permanent deletion" });
    await deleteSection.locator(`a[href="/meetings/${meetingId}/delete"]`).click();

    // Clear scope text, naming everything that is destroyed.
    await expect(page).toHaveTitle(/^Delete meeting permanently - Willycrumbs$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Delete meeting permanently" }),
    ).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
    const scope = page.getByRole("region", { name: "What will be destroyed" });
    for (const part of ["note", "transcript", "audio", "search"]) {
      await expect(scope).toContainText(part);
    }
    await expect(page.getByText("cannot be undone")).toBeVisible();
    await noHorizontalScroll(page);

    // Without the word nothing happens: wrong word and empty word.
    await page.getByLabel("Type DELETE to confirm").fill("delete");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.locator(".field-error")).toContainText("Type DELETE");
    expect(meetingStatus(meetingId)).toBe("scheduled");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.locator(".field-error")).toContainText("Type DELETE");
    expect(meetingStatus(meetingId)).toBe("scheduled");
    // The same check holds for a request that skips the page entirely.
    const origin = new URL(page.url()).origin;
    const skipped = await page.request.post(`/meetings/${meetingId}/delete`, {
      headers: { origin, "x-csrf-token": token },
      form: { confirmation: "" },
    });
    expect(skipped.status()).toBe(422);
    expect(meetingStatus(meetingId)).toBe("scheduled");

    // With the word, the deletion starts and the job is shown on the settings screen.
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page).toHaveURL(/\/settings\?notice=deletion_requested/);
    await expect(page.getByRole("status").filter({ hasText: "Deletion started" })).toBeVisible();
    const row = deletionRow(page, meetingId);
    // Another test's job run may already have picked the job up, so any state after "Queued" is fine.
    await expect(row).toContainText(/Queued|Deleting|Deleted/);

    // From now on the meeting does not exist for its owner, on any surface.
    expect((await page.request.get(`/meetings/${meetingId}`)).status()).toBe(404);
    expect((await page.request.get(`/meetings/${meetingId}/export.md`)).status()).toBe(404);
    expect((await page.request.get(`/api/meetings/${meetingId}/status`)).status()).toBe(404);
    await expect(deleteSection.locator(`a[href="/meetings/${meetingId}/delete"]`)).toHaveCount(0);

    // Asking again is safe: it points back at the one job instead of a 404.
    await page.goto(`/meetings/${meetingId}/delete`);
    await expect(page).toHaveURL(/\/settings\?notice=deletion_repeated/);

    // The job runs; the meeting is erased and the panel says so.
    await runJobs(page, token);
    await page.goto("/settings");
    await expect(deletionRow(page, meetingId)).toContainText("Deleted");
    await expect(deletionRow(page, meetingId)).toContainText(/note, transcript, audio and search/i);
    expect(meetingStatus(meetingId)).toBe("deleted");
    expect((await page.request.get(`/meetings/${meetingId}`)).status()).toBe(404);
  });

  test("shows a queued deletion while its job is pending, and a retrying one with its reason", async ({
    page,
  }) => {
    const pending = createDeletionInState("owner-ada", "pending");
    const retrying = createDeletionInState("owner-ada", "retrying");
    await signIn(page, "ada@example.test");
    await page.goto("/settings");
    await noHorizontalScroll(page);

    const queued = deletionRow(page, pending);
    await expect(queued).toContainText("Queued");
    await expect(queued).toContainText("already hidden");
    await expect(queued.getByRole("button")).toHaveCount(0);

    const again = deletionRow(page, retrying);
    await expect(again).toContainText("Retrying");
    await expect(again).toContainText("storage_unavailable");
    await expect(again).toContainText("Attempt 2 of 5");
    await expect(again).toContainText("Next attempt");
    await expect(again.getByRole("button")).toHaveCount(0);
    // The hidden meetings' titles are never shown.
    await expect(page.getByText("Hidden meeting")).toHaveCount(0);
  });

  test("shows a failed deletion, marks storage degraded, and retries it", async ({ page }) => {
    const failed = createDeletionInState("owner-ada", "failed");
    await signIn(page, "ada@example.test");
    await page.goto("/settings");

    const row = deletionRow(page, failed);
    await expect(row).toContainText("Failed");
    await expect(row).toContainText("storage_unavailable");
    await expect(row).toContainText("stays hidden");
    const storage = page
      .getByRole("region", { name: "Provider status" })
      .getByRole("listitem")
      .filter({ hasText: "Audio storage" });
    await expect(storage).toContainText("Degraded");
    await expect(storage).toContainText("storage_unavailable");

    await row.getByRole("button", { name: "Retry deletion" }).click();
    await expect(page).toHaveURL(/\/settings\?notice=deletion_retried/);
    await expect(
      page.getByRole("status").filter({ hasText: "Deletion queued again" }),
    ).toBeVisible();
    // Another test's job run may already have picked it up, so any later state is fine; Failed is not.
    await expect(deletionRow(page, failed)).toContainText(/Queued|Deleting|Deleted/);
    await expect(deletionRow(page, failed).getByRole("button")).toHaveCount(0);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the whole deletion works as plain forms", async ({ page }, info) => {
      const title = unique("Plain form meeting", info);
      const meetingId = createCapturingMeeting("owner-ada", "scheduled", title);
      await signIn(page, "ada@example.test");
      await page.goto(`/meetings/${meetingId}/delete`);
      await page.getByLabel("Type DELETE to confirm").fill("DELETE");
      await page.getByRole("button", { name: "Delete permanently" }).click();
      await expect(page).toHaveURL(/\/settings\?notice=deletion_requested/);
      await expect(deletionRow(page, meetingId)).toContainText(/Queued|Deleting|Deleted/);
      expect(["deleting", "deleted"]).toContain(meetingStatus(meetingId));
    });
  });
});

test.describe("owner isolation", () => {
  test("owner B cannot see, delete or retry owner A's meeting, and a guessed id is the same 404", async ({
    page,
  }) => {
    const adas = createCapturingMeeting("owner-ada", "scheduled", "Ada private");
    const adasFailed = createDeletionInState("owner-ada", "failed");
    const token = await signIn(page, "ben@example.test");
    const origin = new URL(page.url()).origin;
    const post = (path: string, form: Record<string, string>) =>
      page.request.post(path, { headers: { origin, "x-csrf-token": token }, form });

    // Pages: another owner's id and a made-up id look exactly alike.
    const foreign = await page.request.get(`/meetings/${adas}/delete`);
    const guessed = await page.request.get("/meetings/not-a-real-id/delete");
    expect(foreign.status()).toBe(404);
    expect(guessed.status()).toBe(404);
    expect(await foreign.text()).toBe(await guessed.text());
    expect(await foreign.text()).not.toContain("Ada private");

    // Mutations with the right word still do nothing.
    expect((await post(`/meetings/${adas}/delete`, { confirmation: "DELETE" })).status()).toBe(404);
    expect(
      (await post("/meetings/not-a-real-id/delete", { confirmation: "DELETE" })).status(),
    ).toBe(404);
    expect(meetingStatus(adas)).toBe("scheduled");

    // Retrying someone else's failed deletion is a 404 and changes nothing.
    expect((await post(`/settings/deletions/${adasFailed}/retry`, {})).status()).toBe(404);
    expect((await post("/settings/deletions/not-a-real-id/retry", {})).status()).toBe(404);

    // Ben's own settings never mention Ada's meetings or deletions.
    await page.goto("/settings");
    await expect(page.locator("body")).not.toContainText("Ada private");
    await expect(page.locator("body")).not.toContainText(adasFailed);

    // Mutations need the CSRF token.
    const noToken = await page.request.post(`/meetings/${adas}/delete`, {
      headers: { origin },
      form: { confirmation: "DELETE" },
    });
    expect(noToken.status()).toBe(403);
    expect(meetingStatus(adas)).toBe("scheduled");
  });
});
