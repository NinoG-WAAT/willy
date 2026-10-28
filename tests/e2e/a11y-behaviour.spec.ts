import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import {
  createCapturingMeeting,
  createReviewMeeting,
  meetingStatus,
  reviewFolderName,
} from "../support/e2e-db";
import { installFakeMicrophone } from "../support/fake-microphone";

/**
 * Accessibility behaviour that a static axe scan cannot judge (issue #21): keyboard-only
 * journeys, visible focus, current-page marking, reduced motion, reflow at 320px, and the phone
 * layout being designed rather than a stacked desktop. Axe scans of every screen live in
 * a11y.spec.ts.
 */

const PASSWORD = "willy-dev-password";

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 600;

async function signIn(page: Page, email = "ada@example.test"): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

/** Moves focus to the target using only the Tab key (fails if it is not reachable in order). */
async function tabTo(page: Page, target: Locator, limit = 120): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("the control was not reachable with the Tab key");
}

/** Focus the field with Tab, then type into it as a keyboard user would. */
async function typeInto(page: Page, field: Locator, text: string): Promise<void> {
  await tabTo(page, field);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}

const unique = (label: string, info: TestInfo): string =>
  `${label} ${info.project.name} ${String(info.workerIndex)} ${String(Date.now())}`;

test.describe("keyboard-only journeys", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeMicrophone(page);
  });

  test("sign in, create a note, give consent, start and stop capture", async ({ page }, info) => {
    const title = unique("Keyboard note", info);
    await page.goto("/sign-in");
    await typeInto(page, page.getByLabel("Email"), "ada@example.test");
    await typeInto(page, page.getByLabel("Password"), PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Signed in as")).toBeVisible();

    await tabTo(page, page.getByRole("link", { name: "New note" }));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/meetings\/new$/);

    await typeInto(page, page.getByLabel("Title"), title);
    // Native date and time inputs are filled segment by segment in a real browser; the value is
    // set directly, then the form is submitted with the keyboard.
    await page.getByLabel("Date").fill("2030-05-14");
    await page.getByLabel("Start time").fill("09:00");
    await tabTo(page, page.getByRole("button", { name: "Create note" }));
    await page.keyboard.press("Enter");

    await tabTo(page, page.getByRole("link", { name: new RegExp(`Start note for ${title}`) }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

    // Capture cannot be started before the consent box is ticked, and the box is a keyboard stop.
    await expect(page.getByRole("button", { name: "Start capture" })).toBeDisabled();
    await tabTo(page, page.getByLabel(/I have told every participant/));
    await page.keyboard.press("Space");
    await tabTo(page, page.getByRole("button", { name: "Start capture" }));
    await page.keyboard.press("Enter");
    await expect(page.locator("#rec-banner")).toContainText("Recording");

    // Rough notes can be typed while recording, then capture is stopped from the keyboard.
    await typeInto(page, page.getByLabel(/Your notes/), "Typed with the keyboard");
    await tabTo(page, page.getByRole("button", { name: "Stop capture" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: /Recording finished/ })).toBeVisible();
  });

  test("review: rename a speaker and publish with the keyboard", async ({ page }) => {
    await signIn(page);
    const id = await createReviewMeeting("owner-ada");
    await page.goto(`/meetings/${id}/review`);

    await tabTo(page, page.getByLabel("Speaker to rename"));
    await page.keyboard.press("ArrowDown");
    await typeInto(page, page.getByLabel("New name"), "Ada Lovelace");
    await tabTo(page, page.getByRole("button", { name: "Rename speaker" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Speaker renamed" })).toBeVisible();

    // Publish into the meeting's own folder (never the shared seeded one, other tests count its notes).
    const folder = page.getByLabel("Private folder");
    await tabTo(page, folder);
    await folder.selectOption({ label: reviewFolderName(id) });
    await tabTo(page, page.getByLabel("I have reviewed this note and want to publish it."));
    await page.keyboard.press("Space");
    await tabTo(page, page.getByRole("button", { name: "Publish to folder" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Published." })).toBeVisible();
    expect(meetingStatus(id)).toBe("published");
  });

  test("search, open a result and reach the delete confirmation", async ({ page }) => {
    await signIn(page);
    await page.goto("/search");
    await typeInto(page, page.getByLabel("Search your notes"), "roadmap");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("results for");

    await tabTo(page, page.getByRole("link", { name: /Export Markdown/ }).first());
    await tabTo(page, page.getByRole("link", { name: "Open" }).first());

    const meeting = createCapturingMeeting("owner-ada", "scheduled", "Keyboard delete");
    await page.goto(`/meetings/${meeting}/delete`);
    await typeInto(page, page.getByLabel("Type DELETE to confirm"), "nope");
    await page.keyboard.press("Enter");
    await expect(page.locator(".field-error")).toContainText("Type DELETE");
    expect(meetingStatus(meeting)).toBe("scheduled");
  });
});

test.describe("focus, navigation and motion", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const path of ["/", "/search", "/settings", "/meetings/meeting-a-overdue/review"]) {
    test(`every control shows a visible focus ring: ${path}`, async ({ page }) => {
      await page.goto(path);
      const seen = new Set<string>();
      const missing: string[] = [];
      for (let i = 0; i < 80; i += 1) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return {
            key: `${el.tagName}#${el.id}.${el.getAttribute("name") ?? ""}.${el.textContent.slice(0, 20)}`,
            outlineWidth: parseFloat(style.outlineWidth),
            outlineStyle: style.outlineStyle,
            visible: box.width > 0 && box.height > 0,
          };
        });
        if (!info || seen.has(info.key)) continue;
        seen.add(info.key);
        if (info.visible && (info.outlineStyle === "none" || info.outlineWidth < 2)) {
          missing.push(info.key);
        }
      }
      expect(seen.size, "the page has focusable controls").toBeGreaterThan(3);
      expect(missing, "controls without a visible focus outline").toEqual([]);
    });
  }

  test("the navigation marks the current page without relying on colour", async ({ page }) => {
    await page.goto("/search");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Search" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Meetings" })).not.toHaveAttribute("aria-current");
    const decoration = await nav
      .getByRole("link", { name: "Search" })
      .evaluate((el) => getComputedStyle(el).textDecorationLine + getComputedStyle(el).fontWeight);
    const other = await nav
      .getByRole("link", { name: "Meetings" })
      .evaluate((el) => getComputedStyle(el).textDecorationLine + getComputedStyle(el).fontWeight);
    expect(decoration).not.toBe(other);
  });

  test("the recording indicator stops pulsing for people who ask for less motion", async ({
    page,
  }) => {
    const id = createCapturingMeeting("owner-ada", "capturing", "Reduced motion");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`/meetings/${id}`);
    const shape = page.locator(".rec-shape");
    await expect(shape).toBeVisible();
    expect(await shape.evaluate((el) => getComputedStyle(el).animationName)).not.toBe("none");

    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await shape.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    // The state is still visible without motion: the text label stays.
    await expect(page.locator("#rec-label")).toHaveText("Recording");
  });

  test("the search forms are landmarks and the folder filter is named", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("search")).toHaveCount(1);
    await expect(page.getByRole("form", { name: "Filter meetings" })).toHaveCount(1);
  });
});

test.describe("reflow and phone layout", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const path of [
    "/",
    "/meetings/new",
    "/search?q=roadmap",
    "/settings",
    "/settings/templates/new",
    "/meetings/meeting-a-overdue/review",
  ]) {
    test(`content reflows at 320px without horizontal scroll: ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("the phone header is one compact bar plus one row of navigation", async ({ page }) => {
    test.skip(!isPhone(page), "phone layout only");
    await page.goto("/");
    const brand = await page.locator(".brand").boundingBox();
    const signOut = await page.getByRole("button", { name: "Sign out" }).boundingBox();
    const nav = await page.getByRole("navigation", { name: "Main" }).boundingBox();
    const header = await page.getByRole("banner").boundingBox();
    if (!brand || !signOut || !nav || !header) throw new Error("header boxes are missing");
    // Brand and sign-out share a row; navigation is a single row below; no wrapping to a third.
    expect(Math.abs(brand.y + brand.height / 2 - (signOut.y + signOut.height / 2))).toBeLessThan(
      12,
    );
    expect(nav.y).toBeGreaterThanOrEqual(brand.y + brand.height - 1);
    expect(nav.height).toBeLessThanOrEqual(60);
    // Every navigation link is on screen at once: nothing is hidden behind a sideways scroll.
    const hidden = await page
      .getByRole("navigation", { name: "Main" })
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(hidden).toBeLessThanOrEqual(0);
    expect(header.height).toBeLessThanOrEqual(140);
  });

  test("on a phone, fields and primary buttons use the full width", async ({ page }) => {
    test.skip(!isPhone(page), "phone layout only");
    await page.goto("/search");
    const width = page.viewportSize()?.width ?? 0;
    const input = await page.getByLabel("Search your notes").boundingBox();
    const folder = await page.getByLabel("Folder").boundingBox();
    const submit = await page.getByRole("button", { name: "Search", exact: true }).boundingBox();
    if (!input || !folder || !submit) throw new Error("boxes are missing");
    for (const box of [input, folder, submit]) {
      expect(box.width).toBeGreaterThanOrEqual(width - 2 * 16 - 2);
    }
  });

  test("on a phone, a note's primary actions are full-width tap targets", async ({ page }) => {
    test.skip(!isPhone(page), "phone layout only");
    await page.goto("/");
    const width = page.viewportSize()?.width ?? 0;
    const open = await page.locator(".meeting .button").first().boundingBox();
    if (!open) throw new Error("no meeting action");
    expect(open.width).toBeGreaterThanOrEqual(width - 2 * 16 - 2 - 32);
  });

  test("on a phone, the live note keeps Pause and Stop within thumb reach", async ({ page }) => {
    test.skip(!isPhone(page), "phone layout only");
    const id = createCapturingMeeting("owner-ada", "capturing", "Thumb reach");
    await installFakeMicrophone(page);
    await page.goto(`/meetings/${id}`);
    const stop = page.getByRole("button", { name: "Stop capture" });
    await expect(stop).toBeVisible();
    const height = page.viewportSize()?.height ?? 0;
    // The recording state and the stop control are both on the first screen, without scrolling.
    await expect(page.locator("#rec-banner")).toBeInViewport();
    const box = await stop.boundingBox();
    if (!box) throw new Error("stop box is missing");
    expect(box.y + box.height).toBeLessThanOrEqual(height);
  });
});
