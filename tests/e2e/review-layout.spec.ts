import { expect, test, type Locator, type Page } from "@playwright/test";
import { createReviewMeeting, meetingStatus, reviewFolderName } from "../support/e2e-db";

/**
 * Issue #99: the review as a document. One reading column, the transcript on demand (closed until
 * asked for or until a source link cites lines), speakers as chips with the forms behind a
 * disclosure, and the publish controls as a bar at the bottom of the viewport that never covers
 * the last line. Behaviour of the forms themselves is covered in review.spec.ts.
 */

const PASSWORD = "willy-dev-password";
/** Lines added to the three seeded ones: a meeting of about 18 minutes, like a real one. */
const EXTRA_LINES = 278;
const TOTAL_LINES = EXTRA_LINES + 3;

async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 600;

const panel = (page: Page): Locator => page.locator("#transcript-panel");
const bar = (page: Page): Locator => page.locator(".publish-bar");

async function box(locator: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

async function longMeeting(page: Page): Promise<string> {
  await signIn(page);
  return createReviewMeeting("owner-ada", EXTRA_LINES);
}

test.describe("the transcript panel", () => {
  test("is closed by default and says how long and how many lines", async ({ page }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review`);
    await expect(panel(page)).toHaveJSProperty("open", false);
    await expect(panel(page).locator("> summary")).toHaveText(
      new RegExp(`^Transcript, \\d+:\\d{2}, ${String(TOTAL_LINES)} lines$`),
    );
    // Closed means closed: no line is on screen.
    await expect(page.locator("#seg-20003")).toBeHidden();
    await panel(page).locator("> summary").click();
    await expect(panel(page)).toHaveJSProperty("open", true);
    // Lines carry the real meeting time (not the time into their chunk) and the speaker.
    const line = page.locator("#seg-20003");
    await expect(line).toBeVisible();
    await expect(line.locator(".seg-time")).toHaveText("0:16");
    await expect(line).toContainText("Speaker 1");
    await expect(page.getByRole("link", { name: "Back to the summary" })).toBeVisible();
  });

  test("a source link in the address opens it on the cited line, which is visible", async ({
    page,
  }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review?src=20003-20004#seg-20003`);
    await expect(panel(page)).toHaveJSProperty("open", true);
    await expect(page.locator(".transcript li.is-source")).toHaveCount(2);
    await expect(page.locator("#seg-20003")).toHaveClass(/is-source/);
    await expect(page.locator("#seg-20003 .seg-flag")).toBeVisible();
    await expect(page.locator("#seg-20003")).toBeInViewport();
    await expect(page.locator("#seg-20005")).not.toHaveClass(/is-source/);
  });

  test("a search hit opens it with the lines the hit cites marked", async ({ page }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review?hit=decision:${id}-dec-0`);
    await expect(panel(page)).toHaveJSProperty("open", true);
    await expect(page.locator("#seg-1")).toHaveClass(/is-source/);
    await expect(page.locator("#seg-1")).toBeVisible();
  });

  test("a bad source or a foreign hit leaves it closed", async ({ page }) => {
    const id = await longMeeting(page);
    for (const query of ["src=9-1", "src=nope", `hit=decision:other-note-dec-0`]) {
      await page.goto(`/meetings/${id}/review?${query}`);
      await expect(panel(page)).toHaveJSProperty("open", false);
      await expect(page.locator(".transcript li.is-source")).toHaveCount(0);
    }
  });

  test("following a source chip opens a closed panel and lands on the line", async ({ page }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review`);
    await expect(panel(page)).toHaveJSProperty("open", false);
    await page
      .locator(`#decision-${id}-dec-0`)
      .getByRole("link", { name: /Source: transcript/ })
      .click();
    await expect(panel(page)).toHaveJSProperty("open", true);
    await expect(page.locator("#seg-1")).toHaveClass(/is-source/);
    await expect(page.locator("#seg-1")).toBeInViewport();
    await expect(page.locator("#source-status")).toContainText("marked");
  });

  test("the jump link opens it", async ({ page }) => {
    test.skip(!isPhone(page), "the jump link is for the stacked layout");
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review`);
    await page.getByRole("link", { name: "Jump to the transcript" }).click();
    await expect(panel(page)).toHaveJSProperty("open", true);
    await expect(panel(page)).toBeInViewport();
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("a source link reloads the page with the panel open on the cited lines", async ({
      page,
    }) => {
      const id = await longMeeting(page);
      await page.goto(`/meetings/${id}/review`);
      await expect(panel(page)).toHaveJSProperty("open", false);
      await page
        .locator(`#decision-${id}-dec-0`)
        .getByRole("link", { name: /Source: transcript/ })
        .click();
      await expect(page).toHaveURL(/review\?src=\d+-\d+#seg-/);
      await expect(page.locator("#seg-1")).toBeVisible();
      await expect(page.locator("#seg-1 .seg-flag")).toBeVisible();
      // The panel closes and opens by its summary line alone.
      await panel(page).locator("> summary").click();
      await expect(page.locator("#seg-1")).toBeHidden();
    });
  });
});

test.describe("the speakers", () => {
  test("are one line of chips with their line counts, and no form is in sight", async ({
    page,
  }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review`);
    const chips = page.locator(".speaker-chip");
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toContainText("Speaker 1");
    await expect(chips.first()).toContainText(/\d+ lines/);
    await expect(page.getByLabel("Speaker to rename")).toBeHidden();
    await expect(page.getByLabel("New name")).toBeHidden();
    const [one, two] = [await box(chips.nth(0)), await box(chips.nth(1))];
    expect(Math.abs(one.y - two.y), "the chips share a line").toBeLessThan(2);
    // The whole speakers block is small next to the summary (it used to be a full form).
    expect((await box(page.locator("#speakers"))).h).toBeLessThan(160);
  });

  test("rename works from the disclosure, and a rejected one stays open with its error", async ({
    page,
  }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review`);
    const forms = page.locator(".speaker-forms");
    await expect(forms).toHaveJSProperty("open", false);
    await forms.locator("> summary").click();
    await page.getByLabel("Speaker to rename").selectOption("Speaker 2");
    await page.getByLabel("New name").fill("   ");
    await page.getByRole("button", { name: "Rename speaker" }).click();
    await expect(page.getByRole("alert")).toContainText("not saved");
    await expect(forms).toHaveJSProperty("open", true);
    await expect(page.getByText("Enter a name.")).toBeVisible();
    // The chosen speaker is kept, and a valid name now goes through.
    await expect(page.getByLabel("Speaker to rename")).toHaveValue("Speaker 2");
    await page.getByLabel("New name").fill("Grace Hopper");
    await page.getByRole("button", { name: "Rename speaker" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Speaker renamed" })).toBeVisible();
    await expect(page.locator(".speaker-chip", { hasText: "Grace Hopper" })).toBeVisible();
    await expect(forms).toHaveJSProperty("open", false);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the disclosure opens natively and merge works", async ({ page }) => {
      const id = await longMeeting(page);
      await page.goto(`/meetings/${id}/review`);
      await page.locator(".speaker-forms > summary").click();
      await page.getByLabel("Merge this speaker").selectOption("Speaker 2");
      await page.getByLabel("into").selectOption("Speaker 1");
      await page.getByRole("button", { name: "Merge speakers" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Speakers merged" })).toBeVisible();
      await expect(page.locator(".speaker-chip")).toHaveCount(1);
    });
  });
});

test.describe("the reading column", () => {
  test("is about 72ch wide and centred with the transcript column beside it on a desktop", async ({
    page,
  }) => {
    test.skip(isPhone(page), "desktop layout");
    const id = await longMeeting(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/meetings/${id}/review`);
    const column = await box(page.locator("#summary"));
    expect(column.w).toBeGreaterThan(520);
    expect(column.w).toBeLessThanOrEqual(780);
    const aside = await box(page.locator("#transcript"));
    expect(aside.x).toBeGreaterThanOrEqual(column.x + column.w);
    // The column and the transcript column are centred in the main area as a pair.
    const main = await box(page.getByRole("main"));
    const left = column.x - main.x;
    const right = main.x + main.w - (aside.x + aside.w);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(80);
    // No card per section: the sections of the column have no box of their own.
    const cards = await page
      .locator("#summary > section")
      .evaluateAll(
        (els) => els.filter((el) => getComputedStyle(el).borderLeftWidth !== "0px").length,
      );
    expect(cards).toBe(0);
  });

  test("keeps to the screen on a phone and on a tablet", async ({ page }) => {
    const id = await longMeeting(page);
    for (const width of isPhone(page) ? [390] : [800, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/meetings/${id}/review`);
      const column = await box(page.locator("#summary"));
      expect(column.x).toBeGreaterThanOrEqual(0);
      expect(column.x + column.w).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("the publish bar", () => {
  test("rests at the bottom of the window of a long page and stays there while it scrolls", async ({
    page,
  }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review`);
    await expect(bar(page)).toBeVisible();
    expect(await bar(page).evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    const height = page.viewportSize()?.height ?? 0;
    for (const y of [0, 600, 1500]) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      const b = await box(bar(page));
      expect(b.y + b.h, `bar bottom at scroll ${String(y)}`).toBeLessThanOrEqual(height);
      expect(b.y).toBeGreaterThanOrEqual(0);
      if (isPhone(page)) {
        // Above the fixed tab bar, never under it.
        const tabbar = await box(page.locator(".tabbar"));
        expect(b.y + b.h).toBeLessThanOrEqual(tabbar.y);
      }
    }
    await expect(bar(page)).toContainText("Draft, not published");
  });

  test("never covers the last content at the end of the page", async ({ page }) => {
    const id = await longMeeting(page);
    // The transcript open is the tallest the page gets.
    await page.goto(`/meetings/${id}/review?src=20003-20004#seg-20003`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const b = await box(bar(page));
    const bottoms = await page
      .locator("#summary, #transcript")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().bottom));
    // The aside scrolls inside its own column on a desktop; its box is what is on the page.
    for (const bottom of bottoms) expect(bottom).toBeLessThanOrEqual(b.y + 1);
    if (isPhone(page)) {
      const tabbar = await box(page.locator(".tabbar"));
      expect(b.y + b.h).toBeLessThanOrEqual(tabbar.y);
    }
  });

  test("never covers a focused control: the page scrolls clear of it", async ({ page }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review`);
    const last = page
      .locator("#summary")
      .locator("a[href], button, input:not([type=hidden]), select, textarea, summary")
      .last();
    await last.focus();
    const [target, b] = [await box(last), await box(bar(page))];
    expect(target.y + target.h).toBeLessThanOrEqual(b.y + 1);
    // Also with the publish form open, which makes the bar taller.
    await bar(page).locator("summary").click();
    await last.focus();
    const [again, taller] = [await box(last), await box(bar(page))];
    expect(again.y + again.h).toBeLessThanOrEqual(taller.y + 1);
  });

  test("opens in place, fits the window and publishes", async ({ page }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review`);
    await expect(page.getByLabel("Private folder")).toBeHidden();
    await bar(page).locator("summary").click();
    await expect(page.getByLabel("Private folder")).toBeVisible();
    const b = await box(bar(page));
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.h).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
    await page.getByLabel("Private folder").selectOption({ label: reviewFolderName(id) });
    await page.getByLabel("I have reviewed this note and want to publish it.").check();
    await page.getByRole("button", { name: "Publish to folder" }).click();
    await expect(page.locator("#note-status")).toHaveText("Published");
    expect(meetingStatus(id)).toBe("published");
    // Published is simple: a quiet section, no bar, a Reopen button.
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reopen for editing" })).toBeVisible();
  });

  test("the header's Publish link opens the form and puts the cursor in it", async ({ page }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review`);
    await page.getByRole("banner").first().waitFor();
    await page.locator(".meeting-header").getByRole("link", { name: "Publish to folder" }).click();
    await expect(page.getByLabel("Private folder")).toBeVisible();
    await expect(page.getByLabel("Private folder")).toBeFocused();
  });

  test("a rejected publish comes back open with its error and the folder kept", async ({
    page,
  }) => {
    const id = await longMeeting(page);
    await page.goto(`/meetings/${id}/review`);
    await bar(page).locator("summary").click();
    await page.getByLabel("Private folder").selectOption({ label: reviewFolderName(id) });
    await page.getByRole("button", { name: "Publish to folder" }).click();
    await expect(bar(page).locator("details")).toHaveJSProperty("open", true);
    await expect(page.getByText("Tick the box to confirm")).toBeVisible();
    await expect(page.getByLabel("Private folder")).toHaveValue(`folder-${id}`);
    expect(meetingStatus(id)).toBe("review");
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("is there, sticky, and publishes with plain forms", async ({ page }) => {
      const id = await longMeeting(page);
      await page.goto(`/meetings/${id}/review`);
      expect(await bar(page).evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
      await bar(page).locator("summary").click();
      await page.getByLabel("Private folder").selectOption({ label: reviewFolderName(id) });
      await page.getByLabel("I have reviewed this note and want to publish it.").check();
      await page.getByRole("button", { name: "Publish to folder" }).click();
      await expect(page.locator("#note-status")).toHaveText("Published");
      expect(meetingStatus(id)).toBe("published");
    });
  });

  test("a published note has no bar, a seeded draft with folders has one", async ({ page }) => {
    await signIn(page);
    await page.goto("/meetings/meeting-a-published/review");
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reopen for editing" })).toBeVisible();
    await page.goto("/meetings/meeting-a-overdue/review");
    await expect(bar(page)).toBeVisible();
  });
});
