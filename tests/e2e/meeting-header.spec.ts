import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  advanceProcessing,
  createCapturingMeeting,
  createReviewMeeting,
  setMeetingTemplate,
} from "../support/e2e-db";
import { installFakeMicrophone } from "../support/fake-microphone";

/**
 * Issue #73: one meeting header, shared by the live note and the review, with the status stepper
 * Scheduled > Capturing > Processing > Draft > Published. Every stage is checked on both pages
 * where the page exists for it, at the desktop and the 390x844 viewport (the two Playwright
 * projects), with axe on each state, with JavaScript off, and for another owner's meeting.
 * Seeded rows are only read; tests that need a state create their own meeting.
 */

const PASSWORD = "willy-dev-password";
const WAIT = { timeout: 20_000 };
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
// Seeded rows of owner A (seeds/seed.ts): published into the folder "Board updates" with the
// template "Weekly sync", an overdue draft, and an archived meeting.
const PUBLISHED = "meeting-a-published";
const OVERDUE_DRAFT = "meeting-a-overdue";
const ARCHIVED = "meeting-a-archived";
const LIME = "rgb(228, 242, 34)";

async function signIn(page: Page, email = "ada@example.test"): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

async function audit(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    results.violations.map((v) => ({
      rule: v.id,
      impact: v.impact,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    })),
    `axe violations on ${page.url()}`,
  ).toEqual([]);
}

const header = (page: Page) => page.locator("header.meeting-header");
const stepper = (page: Page) => header(page).getByRole("list", { name: "Note stage" });
const pill = (page: Page) => header(page).locator("[data-stage-label]");
const summary = (page: Page) => header(page).locator("[data-stage-summary]");

/** Links and buttons that are visible and painted acid lime: the view's primary actions. */
async function limeActions(page: Page): Promise<string[]> {
  return page.evaluate((lime) => {
    const found: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("a, button")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || el.closest("[hidden]")) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (style.backgroundColor === lime) found.push((el.textContent ?? "").trim());
    }
    return found;
  }, LIME);
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 600;

interface StageCase {
  name: string;
  /** Creates (or names) the meeting and returns the path to open. */
  open: () => string;
  /** The five steps' labels never change; these are what differs per stage. */
  current: string;
  pill: string;
  summary: string;
  /** Visible acid-lime actions in the whole page, shell included: always exactly one. */
  lime: string;
  /** The header's own action, if the stage has one. */
  action?: { name: string; href: string | RegExp; lime: boolean };
}

const live = (id: string) => `/meetings/${id}`;
const review = (id: string) => `/meetings/${id}/review`;

const LIVE_CASES: StageCase[] = [
  {
    name: "scheduled",
    open: () => live(createCapturingMeeting("owner-ada", "scheduled", "Header scheduled")),
    current: "Scheduled",
    pill: "Scheduled",
    summary: "Step 1 of 5: Scheduled",
    lime: "Start capture",
    action: { name: "Start capture", href: "#consent", lime: true },
  },
  {
    name: "capturing",
    open: () => live(createCapturingMeeting("owner-ada", "capturing", "Header capturing")),
    current: "Capturing",
    pill: "Recording",
    summary: "Step 2 of 5: Capturing",
    lime: "New note",
  },
  {
    name: "paused",
    open: () => live(createCapturingMeeting("owner-ada", "paused", "Header paused")),
    current: "Capturing",
    pill: "Recording paused",
    summary: "Step 2 of 5: Capturing, paused",
    lime: "Resume",
  },
  {
    name: "processing",
    open: () => live(createCapturingMeeting("owner-ada", "processing", "Header processing")),
    current: "Processing",
    pill: "Processing",
    summary: "Step 3 of 5: Processing",
    lime: "New note",
  },
  {
    name: "failed",
    open: () => live(createCapturingMeeting("owner-ada", "failed", "Header failed")),
    current: "Processing",
    pill: "Needs attention",
    summary: "Step 3 of 5: Processing, needs attention",
    lime: "See what happened and retry",
    action: {
      name: "See what happened and retry",
      href: /\/meetings\/e2e-[a-z0-9]+\/review$/,
      lime: true,
    },
  },
  {
    name: "draft",
    open: () => "",
    current: "Draft",
    pill: "Draft",
    summary: "Step 4 of 5: Draft",
    lime: "Open the draft",
    action: { name: "Open the draft", href: /\/meetings\/e2e-[a-z0-9]+\/review$/, lime: true },
  },
  {
    name: "published",
    open: () => live(PUBLISHED),
    current: "Published",
    pill: "Published",
    summary: "Step 5 of 5: Published",
    lime: "New note",
    action: { name: "Open the published note", href: review(PUBLISHED), lime: false },
  },
];

const REVIEW_CASES: StageCase[] = [
  {
    name: "processing",
    open: () => review(createCapturingMeeting("owner-ada", "processing", "Header review wait")),
    current: "Processing",
    pill: "Processing",
    summary: "Step 3 of 5: Processing",
    lime: "New note",
  },
  {
    name: "failed",
    open: () => review(createCapturingMeeting("owner-ada", "failed", "Header review failed")),
    current: "Processing",
    pill: "Needs attention",
    summary: "Step 3 of 5: Processing, needs attention",
    lime: "Retry transcription",
  },
  {
    name: "draft",
    open: () => "",
    current: "Draft",
    pill: "Draft",
    summary: "Step 4 of 5: Draft",
    lime: "Publish to folder",
    action: { name: "Publish to folder", href: "#publish", lime: true },
  },
  {
    name: "overdue draft",
    open: () => review(OVERDUE_DRAFT),
    current: "Draft",
    pill: "Draft",
    summary: "Step 4 of 5: Draft",
    lime: "Publish to folder",
    action: { name: "Publish to folder", href: "#publish", lime: true },
  },
  {
    name: "published",
    open: () => review(PUBLISHED),
    current: "Published",
    pill: "Published",
    summary: "Step 5 of 5: Published",
    lime: "New note",
    action: { name: "Reopen for editing", href: "#publish", lime: false },
  },
];

/** Draft cases need a meeting in review, which is created per test. */
async function pathFor(c: StageCase, page: "live" | "review"): Promise<string> {
  if (c.name !== "draft") return c.open();
  const id = await createReviewMeeting("owner-ada");
  return page === "live" ? live(id) : review(id);
}

async function expectStage(page: Page, c: StageCase): Promise<void> {
  await expect(header(page)).toBeVisible();
  await expect(header(page).getByRole("heading", { level: 1 })).toBeVisible();
  const steps = stepper(page).getByRole("listitem");
  await expect(steps).toHaveText(
    [/Scheduled/, /Capturing/, /Processing/, /Draft/, /Published/],
    // toHaveText on a list matches each item in order.
  );
  // Exactly one current step, named by aria-current="step" and by its words.
  const current = stepper(page).locator('[aria-current="step"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText(c.current);
  await expect(current).toContainText(
    c.pill === "Needs attention" ? "Needs attention" : "Current step",
  );
  await expect(pill(page)).toHaveText(c.pill);
  await expect(summary(page)).toHaveText(c.summary);
}

for (const c of LIVE_CASES) {
  test(`live note, ${c.name}: header, stepper, one lime action`, async ({ page }) => {
    await installFakeMicrophone(page);
    await signIn(page);
    const path = await pathFor(c, "live");
    await page.goto(path);
    await expectStage(page, c);
    expect(await limeActions(page)).toEqual([c.lime]);
    if (c.action !== undefined) {
      const link = header(page).getByRole("link", { name: c.action.name });
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute("href", c.action.href);
      expect(await limeActions(page)).toEqual(c.action.lime ? [c.action.name] : [c.lime]);
    }
    await noHorizontalScroll(page);
    await audit(page);
  });
}

for (const c of REVIEW_CASES) {
  test(`review, ${c.name}: header, stepper, one lime action`, async ({ page }) => {
    await signIn(page);
    const path = await pathFor(c, "review");
    await page.goto(path);
    await expectStage(page, c);
    expect(await limeActions(page)).toEqual([c.lime]);
    if (c.action !== undefined) {
      const link = header(page).getByRole("link", { name: c.action.name });
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute("href", c.action.href);
    }
    await noHorizontalScroll(page);
    await audit(page);
  });
}

test("the same meeting says the same status words on the live note and on the review", async ({
  page,
}) => {
  await signIn(page);
  const id = await createReviewMeeting("owner-ada");
  await page.goto(live(id));
  const onLive = await pill(page).innerText();
  const stepOnLive = await summary(page).innerText();
  const title = await header(page).getByRole("heading", { level: 1 }).innerText();
  const when = await header(page).locator("time").first().innerText();
  await page.goto(review(id));
  expect(await pill(page).innerText()).toBe(onLive);
  expect(await summary(page).innerText()).toBe(stepOnLive);
  expect(await header(page).getByRole("heading", { level: 1 }).innerText()).toBe(title);
  expect(await header(page).locator("time").first().innerText()).toBe(when);
  expect(onLive).toBe("Draft");
});

test("a draft says it is not published, in words", async ({ page }) => {
  await signIn(page);
  await page.goto(review(OVERDUE_DRAFT));
  await expect(header(page)).toContainText("Not published");
});

test.describe("chips", () => {
  test("a published note links to its folder and its template, on both pages", async ({ page }) => {
    await signIn(page);
    for (const path of [live(PUBLISHED), review(PUBLISHED)]) {
      await page.goto(path);
      const folder = header(page).getByRole("link", { name: "Folder: Board updates" });
      await expect(folder).toHaveAttribute("href", "/folders/folder-a-board");
      const template = header(page).getByRole("link", { name: "Template: Weekly sync" });
      await expect(template).toHaveAttribute("href", "/settings/templates/template-a-weekly");
    }
    await page.goto(live(PUBLISHED));
    await header(page).getByRole("link", { name: "Folder: Board updates" }).click();
    await expect(page).toHaveURL("/folders/folder-a-board");
  });

  test("a draft has no folder chip yet, and no template chip when none is set", async ({
    page,
  }) => {
    await signIn(page);
    const id = await createReviewMeeting("owner-ada");
    for (const path of [live(id), review(id)]) {
      await page.goto(path);
      await expect(header(page).getByRole("link", { name: /^Folder:/ })).toHaveCount(0);
      await expect(header(page).getByRole("link", { name: /^Template:/ })).toHaveCount(0);
    }
  });

  test("a template shows before anything is published", async ({ page }) => {
    await signIn(page);
    const id = createCapturingMeeting("owner-ada", "scheduled", "Header template");
    setMeetingTemplate(id, "template-a-weekly");
    await page.goto(live(id));
    await expect(header(page).getByRole("link", { name: "Template: Weekly sync" })).toBeVisible();
    await expect(header(page).getByRole("link", { name: /^Folder:/ })).toHaveCount(0);
    await audit(page);
  });
});

test.describe("archived", () => {
  test("is its own state, not a step", async ({ page }) => {
    await signIn(page);
    for (const path of [live(ARCHIVED), review(ARCHIVED)]) {
      await page.goto(path);
      await expect(header(page)).toBeVisible();
      await expect(pill(page)).toHaveText("Archived");
      await expect(stepper(page)).toHaveCount(0);
      await expect(header(page)).toContainText("archived");
      expect(await limeActions(page)).toEqual(["New note"]);
      await noHorizontalScroll(page);
      await audit(page);
    }
  });
});

test.describe("stepper accessibility", () => {
  test("is an ordered list with aria-current on one step and state in words", async ({ page }) => {
    await signIn(page);
    await page.goto(review(OVERDUE_DRAFT));
    const list = stepper(page);
    expect(await list.evaluate((el) => el.tagName)).toBe("OL");
    const items = list.getByRole("listitem");
    await expect(items).toHaveCount(5);
    const states = await items.evaluateAll((els) => els.map((el) => el.textContent ?? ""));
    expect(states[0]).toContain("Done");
    expect(states[2]).toContain("Done");
    expect(states[3]).toContain("Current step");
    expect(states[4]).toContain("Upcoming");
    await expect(list.locator('[aria-current="step"]')).toHaveCount(1);
  });

  test("failed is spelled out on the Processing step, not shown by colour", async ({ page }) => {
    await signIn(page);
    const id = createCapturingMeeting("owner-ada", "failed", "Header attention");
    await page.goto(review(id));
    const processing = stepper(page).getByRole("listitem").nth(2);
    await expect(processing).toHaveAttribute("aria-current", "step");
    await expect(processing).toContainText("Needs attention");
    await expect(processing.locator(".step-state")).toBeVisible();
  });

  test("on a phone the position is spelled out and nothing scrolls sideways", async ({ page }) => {
    await signIn(page);
    await page.goto(review(OVERDUE_DRAFT));
    await expect(summary(page)).toBeVisible();
    await expect(summary(page)).toHaveText("Step 4 of 5: Draft");
    if (isPhone(page)) {
      const box = await stepper(page).boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(390);
    }
    await noHorizontalScroll(page);
  });

  test("reduced motion and forced colors keep the stepper readable", async ({ page }) => {
    await signIn(page);
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await page.goto(review(OVERDUE_DRAFT));
    await expect(summary(page)).toBeVisible();
    const current: Locator = stepper(page).locator('[aria-current="step"]');
    await expect(current).toBeVisible();
    // Without colour the current step still differs: a visible border on the marker.
    const border = await current
      .locator(".step-mark")
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(parseFloat(border)).toBeGreaterThan(0);
    await audit(page);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the header, the stepper and the actions are server-rendered", async ({ page }) => {
    await signIn(page);
    const scheduled = createCapturingMeeting("owner-ada", "scheduled", "Header no JS");
    await page.goto(live(scheduled));
    await expect(stepper(page).locator('[aria-current="step"]')).toContainText("Scheduled");
    await expect(header(page).getByRole("link", { name: "Start capture" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start capture" })).toBeVisible();
    const id = await createReviewMeeting("owner-ada");
    await page.goto(review(id));
    await expect(stepper(page).locator('[aria-current="step"]')).toContainText("Draft");
    await expect(header(page).getByRole("link", { name: "Publish to folder" })).toBeVisible();
    // The link lands on the form, which still publishes with its own button.
    await header(page).getByRole("link", { name: "Publish to folder" }).click();
    await expect(page).toHaveURL(/#publish$/);
    await expect(page.getByRole("button", { name: "Publish to folder" })).toBeVisible();
  });
});

test.describe("one primary action, and the buttons that stay where they were", () => {
  test("the start button and the publish button keep their own forms, just not lime", async ({
    page,
  }) => {
    await signIn(page);
    const scheduled = createCapturingMeeting("owner-ada", "scheduled", "Header start form");
    await page.goto(live(scheduled));
    const start = page.getByRole("button", { name: "Start capture" });
    await expect(start).toBeVisible();
    expect(await start.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(LIME);
    const id = await createReviewMeeting("owner-ada");
    await page.goto(review(id));
    const publish = page.getByRole("button", { name: "Publish to folder" });
    expect(await publish.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(LIME);
  });

  test("the header link to the consent statement reaches the checkbox", async ({ page }) => {
    await signIn(page);
    const scheduled = createCapturingMeeting("owner-ada", "scheduled", "Header consent link");
    await page.goto(live(scheduled));
    await header(page).getByRole("link", { name: "Start capture" }).click();
    await expect(page).toHaveURL(/#consent$/);
    await expect(page.getByLabel(/I have told every participant/)).toBeVisible();
  });
});

test.describe("the stepper follows the work", () => {
  test("moves from Processing to Draft in place when the draft is ready", async ({ page }) => {
    await signIn(page);
    const id = createCapturingMeeting("owner-ada", "processing", "Header follows");
    advanceProcessing(id, { meeting: "processing", transcription: "running" });
    await page.goto(live(id));
    // Typing keeps the page where it is: the draft is not opened by itself.
    await page.getByLabel("Your notes (saved as you type)").focus();
    await expect(stepper(page).locator('[aria-current="step"]')).toContainText("Processing");
    await page.evaluate(() => {
      (window as unknown as { sameDocument: boolean }).sameDocument = true;
    });
    advanceProcessing(id, { meeting: "review", transcription: "succeeded", summary: "succeeded" });
    await expect(stepper(page).locator('[aria-current="step"]')).toContainText("Draft", WAIT);
    await expect(pill(page)).toHaveText("Draft");
    await expect(summary(page)).toHaveText("Step 4 of 5: Draft");
    expect(
      await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument),
    ).toBe(true);
    await audit(page);
  });

  test("shows Needs attention on the Processing step when processing fails", async ({ page }) => {
    await signIn(page);
    const id = createCapturingMeeting("owner-ada", "processing", "Header follows failure");
    advanceProcessing(id, { meeting: "processing", transcription: "running" });
    await page.goto(live(id));
    await page.getByLabel("Your notes (saved as you type)").focus();
    advanceProcessing(id, { meeting: "failed", transcription: "failed", errorCode: "stt_down" });
    const current = stepper(page).locator('[aria-current="step"]');
    await expect(current).toContainText("Needs attention", WAIT);
    await expect(current).toContainText("Processing");
    await expect(pill(page)).toHaveText("Needs attention");
  });
});

test.describe("another owner", () => {
  test("cannot see the header of a meeting that is not theirs: both pages are a 404", async ({
    page,
  }) => {
    await signIn(page, "ben@example.test");
    for (const path of [live(PUBLISHED), review(PUBLISHED), live("does-not-exist")]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.locator("header.meeting-header")).toHaveCount(0);
      await expect(page.getByText("Weekly sync with Grace")).toHaveCount(0);
    }
  });
});
