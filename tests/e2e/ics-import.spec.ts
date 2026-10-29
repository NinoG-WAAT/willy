import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { DEV_PASSWORD, createFreshOwner, type FreshOwner } from "../support/journey-db";

// ICS file import (#57): upload or paste an Outlook-style export, preview, confirm. Every test owns
// a fresh owner so imports cannot collide with tests running in parallel. Runs on the desktop and
// the 390x844 phone project. The fixture is synthetic: no real calendar or attendee data.

const expect = baseExpect.configure({ timeout: 15_000 });

// Playwright runs from the repository root.
const FIXTURE_PATH = "tests/fixtures/ics/outlook-week.ics";
const FIXTURE = readFileSync(FIXTURE_PATH);
const FIXTURE_TEXT = FIXTURE.toString("utf8");

async function signIn(page: Page, owner: Pick<FreshOwner, "email">): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

async function openImport(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Import from ICS file" }).click();
  await expect(page).toHaveURL("/meetings/import/ics");
  await expect(
    page.getByRole("heading", { level: 1, name: "Import from an ICS file" }),
  ).toBeVisible();
}

async function previewFixture(page: Page): Promise<void> {
  await page.getByLabel("Calendar file (.ics, up to 1 MB)").setInputFiles(FIXTURE_PATH);
  await page.getByRole("button", { name: "Preview events" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Preview" })).toBeVisible();
}

function card(page: Page, title: string) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: title }) });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("upload, preview, confirm", () => {
  let owner: FreshOwner;
  test.beforeEach(async ({ page }) => {
    owner = createFreshOwner();
    await signIn(page, owner);
  });

  test("an Outlook export is previewed, confirmed, and its meetings appear on the home screen", async ({
    page,
  }) => {
    await openImport(page);
    await noHorizontalScroll(page);
    await previewFixture(page);
    await noHorizontalScroll(page);

    await expect(page.getByRole("status").filter({ hasText: "Found 6 events" })).toContainText(
      "Nothing has been imported yet",
    );
    // The weekly standup is a series: reported, not expanded, not selectable.
    await expect(page.getByText("1 recurring series was not expanded")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: /^Team standup$/ })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(5);
    // The cancelled event is listed and says why it is not selectable.
    await expect(card(page, "Canceled: Budget review")).toContainText("Cancelled in the calendar");
    await expect(card(page, "Canceled: Budget review").getByRole("checkbox")).toHaveCount(0);
    // Times are in each event's own zone, from the Windows zone names.
    await expect(page.getByRole("checkbox", { name: "Product sync" })).toBeChecked();
    await expect(page.getByText(/Tue, 3 Nov, 10:00 CET|Tue 3 Nov, 10:00 CET/)).toBeVisible();

    await page.getByRole("checkbox", { name: "Company offsite" }).uncheck();
    await page.getByRole("button", { name: "Import selected events" }).click();

    await expect(page).toHaveURL(/\/\?notice=ics_imported/);
    await expect(
      page.getByRole("status").filter({ hasText: "Imported 4 new meetings" }),
    ).toContainText("0 events were already in your list");
    await expect(card(page, "Product sync")).toContainText("From your calendar");
    await expect(card(page, "Product sync")).toContainText("2 attendees");
    await expect(card(page, "Product sync")).toContainText("Consent: ");
    await expect(card(page, "Design review; v2, final")).toBeVisible();
    await expect(card(page, "Investor update call")).toBeVisible();
    await expect(card(page, "Team standup (moved)")).toBeVisible();
    await expect(card(page, "Company offsite")).toHaveCount(0);
    await expect(card(page, "Canceled: Budget review")).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test("importing the same file again adds no duplicates and reports what was already there", async ({
    page,
  }) => {
    await openImport(page);
    await previewFixture(page);
    await page.getByRole("button", { name: "Import selected events" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Imported 5 new meetings" }),
    ).toBeVisible();

    await openImport(page);
    await previewFixture(page);
    await page.getByRole("button", { name: "Import selected events" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Imported 0 new meetings" }),
    ).toContainText("5 events were already in your list");
    await expect(card(page, "Product sync")).toHaveCount(1);
  });

  test("pasted text works the same as a file", async ({ page }) => {
    await openImport(page);
    await page.getByLabel("Or paste the calendar text").fill(FIXTURE_TEXT);
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByRole("checkbox", { name: "Product sync" })).toBeChecked();
    await page.getByRole("button", { name: "Import selected events" }).click();
    await expect(card(page, "Product sync")).toBeVisible();
  });

  test("links in the invitation stay plain text: shown, never linked or fetched", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));
    await openImport(page);
    await previewFixture(page);
    const sync = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("checkbox", { name: "Product sync" }) });
    await expect(sync).toContainText("Microsoft Teams meeting");
    await expect(sync).toContainText("teams.microsoft.com");
    await expect(page.getByRole("main").locator("a[href*='teams.microsoft.com']")).toHaveCount(0);
    expect(requested.filter((u) => u.includes("microsoft.com"))).toEqual([]);
  });

  test("markup in a title is shown as text and never runs", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const hostile = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:xss-1",
      "SUMMARY:<img src=x onerror=alert(1)><script>alert(2)</script>",
      "DESCRIPTION:<b onmouseover=alert(3)>hi</b>",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    await openImport(page);
    await page.getByLabel("Or paste the calendar text").fill(hostile);
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
    await expect(page.locator(".rows img, .rows script, .rows b")).toHaveCount(0);
    await page.getByRole("button", { name: "Import selected events" }).click();
    await expect(
      page.getByRole("heading", { level: 3 }).getByText("<img src=x onerror=alert(1)>"),
    ).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test("start over leaves nothing imported", async ({ page }) => {
    await openImport(page);
    await previewFixture(page);
    await page.getByRole("link", { name: "Start over" }).click();
    await expect(page.getByRole("button", { name: "Preview events" })).toBeVisible();
    await page.goto("/");
    await expect(card(page, "Product sync")).toHaveCount(0);
  });
});

test.describe("refusals", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, createFreshOwner());
    await openImport(page);
  });

  test("asks for something when the form is empty", async ({ page }) => {
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Choose an .ics file or paste the calendar text",
    );
  });

  test("refuses a file that is not an .ics and does not echo its content", async ({ page }) => {
    await page.getByLabel("Calendar file (.ics, up to 1 MB)").setInputFiles({
      name: "notes.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("MZ secret-looking-content"),
    });
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByRole("alert")).toContainText("Only .ics calendar files are accepted");
    await expect(page.getByText("secret-looking-content")).toHaveCount(0);
  });

  test("refuses text that is not a calendar with a plain message", async ({ page }) => {
    await page.getByLabel("Or paste the calendar text").fill("<html>hello</html> pasted notes");
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByRole("alert")).toContainText("does not look like a calendar");
    await expect(page.getByText("pasted notes")).toHaveCount(0);
  });

  test("refuses a damaged calendar without a stack trace", async ({ page }) => {
    await page
      .getByLabel("Or paste the calendar text")
      .fill("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\n");
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByRole("alert")).toContainText("could not be read as a calendar export");
    await expect(page.locator("body")).not.toContainText(/stack|at \w+ \(|Error:/);
  });

  test("refuses a file and pasted text together", async ({ page }) => {
    await page.getByLabel("Calendar file (.ics, up to 1 MB)").setInputFiles(FIXTURE_PATH);
    await page.getByLabel("Or paste the calendar text").fill(FIXTURE_TEXT);
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByRole("alert")).toContainText("either a file or pasted text");
  });

  test("refuses a file over 1 MB with a clear message and keeps the form", async ({ page }) => {
    await page.getByLabel("Calendar file (.ics, up to 1 MB)").setInputFiles({
      name: "big.ics",
      mimeType: "text/calendar",
      buffer: Buffer.alloc(1_500_000, "a"),
    });
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByRole("alert")).toContainText("larger than 1 MB");
    await expect(page.getByRole("button", { name: "Preview events" })).toBeVisible();
  });

  test("stops an enormous upload before reading it", async ({ page }) => {
    await page.getByLabel("Calendar file (.ics, up to 1 MB)").setInputFiles({
      name: "huge.ics",
      mimeType: "text/calendar",
      buffer: Buffer.alloc(6_000_000, "a"),
    });
    const refused = page.waitForResponse(
      (r) => r.url().endsWith("/meetings/import/ics") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Preview events" }).click();
    expect((await refused).status()).toBe(413);
    await expect(page.getByRole("heading", { level: 1, name: "Upload too large" })).toBeVisible();
  });

  test("refuses a calendar with more events than the limit", async ({ page }) => {
    const events = Array.from({ length: 201 }, (_, i) =>
      [
        "BEGIN:VEVENT",
        `UID:e${String(i)}`,
        "SUMMARY:E",
        "DTSTART:20261103T080000Z",
        "DTEND:20261103T090000Z",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const text = ["BEGIN:VCALENDAR", ...events, "END:VCALENDAR"].join("\r\n");
    await page.getByLabel("Or paste the calendar text").fill(text);
    await page.getByRole("button", { name: "Preview events" }).click();
    await expect(page.getByRole("alert")).toContainText("more than 200 events");
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("upload, preview and confirm work as plain forms", async ({ page }) => {
    await signIn(page, createFreshOwner());
    await openImport(page);
    await previewFixture(page);
    await page.getByRole("button", { name: "Import selected events" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Imported 5 new meetings" }),
    ).toBeVisible();
    await expect(card(page, "Product sync")).toBeVisible();
  });
});

test.describe("owner boundary and request checks", () => {
  async function csrfOf(page: Page): Promise<string> {
    await page.goto("/meetings/import/ics");
    return (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
  }
  const originOf = (page: Page) => new URL(page.url()).origin;

  test("another owner never sees imported meetings and cannot touch them with guessed ids", async ({
    browser,
    page,
  }) => {
    const a = createFreshOwner();
    await signIn(page, a);
    await openImport(page);
    await previewFixture(page);
    await page.getByRole("button", { name: "Import selected events" }).click();
    await expect(card(page, "Product sync")).toBeVisible();
    const meetingHref =
      (await card(page, "Product sync")
        .getByRole("heading")
        .getByRole("link")
        .getAttribute("href")) ?? "";
    expect(meetingHref).toMatch(/^\/meetings\/[^/]+/);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await signIn(pageB, createFreshOwner());
    await expect(card(pageB, "Product sync")).toHaveCount(0);
    // A's meeting URL is a plain 404 for B.
    const guessed = await pageB.goto(meetingHref);
    expect(guessed?.status()).toBe(404);

    const token = await csrfOf(pageB);
    const origin = originOf(pageB);
    // B names A's meeting id (a guessed id) and a real event id from a file B never sent.
    const meetingId = meetingHref.split("/")[2] ?? "";
    for (const event of [
      meetingId,
      "forged-id",
      "040000008200E00074C5B7101A82E00800000000CAFEBABE0123456789ABCDEF01234567",
    ]) {
      const res = await pageB.request.post("/meetings/import/ics/confirm", {
        headers: { origin },
        form: { csrf_token: token, ics_text: FIXTURE_TEXT, floating_zone: "UTC", event },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(303);
      expect(res.headers()["location"]).toContain("problem=unknown_selection");
    }
    // An owner id in the form is an unknown field, not a way to import into someone else's list.
    const forged = await pageB.request.post("/meetings/import/ics/confirm", {
      headers: { origin },
      form: {
        csrf_token: token,
        ics_text: FIXTURE_TEXT,
        floating_zone: "UTC",
        event: "x",
        owner_id: a.id,
      },
      maxRedirects: 0,
    });
    expect(forged.headers()["location"]).toContain("problem=malformed");
    await pageB.goto("/");
    await expect(pageB.getByText("Product sync")).toHaveCount(0);
    await contextB.close();
  });

  test("two owners importing the same file each get their own meetings", async ({
    browser,
    page,
  }) => {
    await signIn(page, createFreshOwner());
    await openImport(page);
    await previewFixture(page);
    await page.getByRole("button", { name: "Import selected events" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Imported 5 new meetings" }),
    ).toBeVisible();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await signIn(pageB, createFreshOwner());
    await openImport(pageB);
    await previewFixture(pageB);
    await pageB.getByRole("button", { name: "Import selected events" }).click();
    await expect(
      pageB.getByRole("status").filter({ hasText: "Imported 5 new meetings" }),
    ).toBeVisible();
    await contextB.close();
  });

  test("anonymous requests are turned away and a missing CSRF token is refused", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const anonymous = await playwright.request.newContext(baseURL ? { baseURL } : {});
    const noSession = await anonymous.post("/meetings/import/ics/confirm", {
      form: { ics_text: "x" },
      maxRedirects: 0,
    });
    expect([302, 303, 401, 403]).toContain(noSession.status());
    await anonymous.dispose();

    await signIn(page, createFreshOwner());
    await page.goto("/meetings/import/ics");
    const origin = originOf(page);
    for (const path of ["/meetings/import/ics", "/meetings/import/ics/confirm"]) {
      const noToken = await page.request.post(path, {
        headers: { origin },
        form: { ics_text: FIXTURE_TEXT },
        maxRedirects: 0,
      });
      expect(noToken.status(), path).toBe(403);
      const forgedToken = await page.request.post(path, {
        headers: { origin },
        form: { csrf_token: "forged", ics_text: FIXTURE_TEXT },
        maxRedirects: 0,
      });
      expect(forgedToken.status(), path).toBe(403);
      const crossOrigin = await page.request.post(path, {
        headers: { origin: "https://evil.example" },
        form: { csrf_token: await csrfOf(page), ics_text: FIXTURE_TEXT },
        maxRedirects: 0,
      });
      expect(crossOrigin.status(), path).toBe(403);
    }
  });

  test("the import is rate limited per owner and answers 429 with Retry-After", async ({
    page,
  }) => {
    await signIn(page, createFreshOwner());
    const token = await csrfOf(page);
    const origin = originOf(page);
    let limited: Awaited<ReturnType<typeof page.request.post>> | null = null;
    for (let i = 0; i < 45 && limited === null; i++) {
      const res = await page.request.post("/meetings/import/ics", {
        headers: { origin },
        multipart: { csrf_token: token, ics_text: "not a calendar", floating_zone: "UTC" },
        maxRedirects: 0,
      });
      if (res.status() === 429) limited = res;
      else expect(res.status()).toBe(422);
    }
    expect(limited, "429 after the allowance is used").not.toBeNull();
    expect(Number(limited?.headers()["retry-after"])).toBeGreaterThan(0);
  });
});
