import { expect, test, type Page } from "@playwright/test";
import {
  addVocabularyTerms,
  createFreshOwner,
  vocabularyTerms,
  type FreshOwner,
} from "../support/journey-db";

/**
 * The Vocabulary screen (issue #106), on the desktop and the phone project. Every test uses its
 * own fresh owner, so no other spec ever sees these words. The no-JavaScript group runs the same
 * core path with scripting turned off: the screen is plain server-rendered forms.
 */

const PASSWORD = "willy-dev-password";

async function signIn(page: Page, owner: FreshOwner): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

const words = (page: Page) => page.getByRole("main").locator(".vocabulary-list .rl-text");
const wordRow = (page: Page, term: string) =>
  page
    .getByRole("main")
    .locator(".vocabulary-list .rl-item")
    .filter({ has: page.getByText(term, { exact: true }) });

async function openVocabulary(page: Page): Promise<void> {
  await page.goto("/settings/vocabulary");
  await expect(page.getByRole("heading", { level: 1, name: "Vocabulary" })).toBeVisible();
}

/** Opens the "Add words" disclosure when it is closed, types and submits. */
async function addWords(page: Page, text: string): Promise<void> {
  const field = page.getByLabel("Words to add");
  if (!(await field.isVisible())) await page.getByText("Add words", { exact: true }).click();
  await field.fill(text);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("signed-out visitors are sent to sign-in; a removal needs a session too", async ({
  page,
  request,
}) => {
  await page.goto("/settings/vocabulary");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings%2Fvocabulary$/);
  const removal = await request.post("/settings/vocabulary/anything/remove", { maxRedirects: 0 });
  expect([302, 303, 401]).toContain(removal.status());
});

test.describe("the screen", () => {
  test("an empty list says what it is for, offers the field open and is linked from Settings", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    await signIn(page, owner);
    await page.goto("/settings");
    await page.getByRole("link", { name: "Edit vocabulary" }).click();
    await expect(page).toHaveURL("/settings/vocabulary");
    await expect(page).toHaveTitle("Vocabulary - Willycrumbs");
    await expect(
      page.getByText(
        "Words your meetings use that a speech recogniser does not know: project names, clients, acronyms.",
      ),
    ).toBeVisible();
    await expect(page.getByText("No words yet.")).toBeVisible();
    await expect(page.getByText(/terms? (is|are) used by the speech recogniser/)).toHaveCount(0);
    await expect(page.getByLabel("Words to add")).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("the Settings page marks itself as the current place in the navigation", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "phone", "the phone has a tab bar, with Settings under More");
    await signIn(page, createFreshOwner());
    await openVocabulary(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("add one word: notice, list, counter, and it survives a reload", async ({ page }) => {
    const owner = createFreshOwner();
    await signIn(page, owner);
    await openVocabulary(page);
    await addWords(page, "  Site   tracker ");
    await expect(page).toHaveURL(/notice=vocabulary_added/);
    await expect(page.getByRole("status")).toHaveText(
      "Words added. They are used for the next transcription.",
    );
    await expect(words(page)).toHaveText(["Site tracker"]);
    await expect(page.getByText("1 of 1 term is used by the speech recogniser.")).toBeVisible();
    await page.reload();
    await expect(words(page)).toHaveText(["Site tracker"]);
    expect(vocabularyTerms(owner.id).map((t) => t.term)).toEqual(["Site tracker"]);
    // With words in the list the field sits behind its disclosure.
    await expect(page.getByLabel("Words to add")).toBeHidden();
  });

  test("pasting several words on separate lines or separated by commas adds them all, in order", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    await signIn(page, owner);
    await openVocabulary(page);
    await addWords(page, "SALSA\nSitetracker, Acme,\r\n\nZed");
    await expect(words(page)).toHaveText(["SALSA", "Sitetracker", "Acme", "Zed"]);
    await expect(page.getByText("4 of 4 terms are used by the speech recogniser.")).toBeVisible();
  });

  test("adding a word that is already there, in other letters, changes nothing", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    addVocabularyTerms(owner.id, ["SALSA"]);
    await signIn(page, owner);
    await openVocabulary(page);
    await addWords(page, "salsa");
    await expect(page.getByRole("status")).toHaveText(
      "Those words were already in your vocabulary. Nothing changed.",
    );
    await expect(words(page)).toHaveText(["SALSA"]);
  });

  test("removes a word and says so; the others stay", async ({ page }) => {
    const owner = createFreshOwner();
    addVocabularyTerms(owner.id, ["Alpha", "Bravo", "Charlie"]);
    await signIn(page, owner);
    await openVocabulary(page);
    await wordRow(page, "Bravo")
      .getByRole("button", { name: /^Remove/ })
      .click();
    await expect(page.getByRole("status")).toHaveText("Word removed.");
    await expect(words(page)).toHaveText(["Alpha", "Charlie"]);
    expect(vocabularyTerms(owner.id).map((t) => t.term)).toEqual(["Alpha", "Charlie"]);
  });

  test("every Remove button names its word for a screen reader", async ({ page }) => {
    const owner = createFreshOwner();
    addVocabularyTerms(owner.id, ["Alpha", "Bravo"]);
    await signIn(page, owner);
    await openVocabulary(page);
    await expect(page.getByRole("button", { name: "Remove Alpha" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Bravo" })).toBeVisible();
  });

  test("refuses bad words with a message, keeps what was typed and adds nothing", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    addVocabularyTerms(owner.id, ["Existing"]);
    await signIn(page, owner);
    await openVocabulary(page);

    await addWords(page, "fine, --model x");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("cannot start with a dash");
    await expect(page.getByLabel("Words to add")).toHaveValue("fine, --model x");
    await expect(page.getByLabel("Words to add")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator(".field-error")).toContainText("cannot start with a dash");
    await expect(words(page)).toHaveText(["Existing"]);

    await page.getByLabel("Words to add").fill("x".repeat(81));
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("at most 80 characters");

    await page.getByLabel("Words to add").fill(" , ,\n");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Enter at least one word.");
    expect(vocabularyTerms(owner.id).map((t) => t.term)).toEqual(["Existing"]);
  });

  test("a long list shows which words do not fit, in words, and how many are used", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    const many = Array.from({ length: 120 }, (_, i) => `Project${String(i).padStart(3, "0")}`);
    addVocabularyTerms(owner.id, many);
    await signIn(page, owner);
    await openVocabulary(page);
    const status = page.locator(".vocabulary-status");
    await expect(status).toContainText(/^\d+ of 120 terms are used by the speech recogniser\./);
    await expect(status).toContainText("do not fit and are left out.");
    const used = Number((await status.innerText()).split(" of ")[0]);
    expect(used).toBeGreaterThan(30);
    expect(used).toBeLessThan(120);
    await expect(page.getByRole("heading", { level: 3, name: "Left out" })).toBeVisible();
    await expect(page.getByText("Not sent", { exact: true })).toHaveCount(120 - used);
    // The marked words are the last ones, in list order.
    await expect(wordRow(page, "Project119")).toContainText("Not sent");
    await expect(wordRow(page, "Project000")).not.toContainText("Not sent");
    await noHorizontalScroll(page);
  });

  test("stops at 200 words with a message, adds none of the paste and keeps the text", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    addVocabularyTerms(
      owner.id,
      Array.from({ length: 199 }, (_, i) => `Filler${String(i)}`),
    );
    await signIn(page, owner);
    await openVocabulary(page);
    await addWords(page, "One fits\nOne too many");
    await expect(page.getByRole("alert")).toContainText("at most 200 words");
    await expect(page.getByLabel("Words to add")).toHaveValue("One fits\nOne too many");
    expect(vocabularyTerms(owner.id)).toHaveLength(199);
    await page.getByLabel("Words to add").fill("One fits");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Words added");
    expect(vocabularyTerms(owner.id)).toHaveLength(200);
  });

  test("works with the keyboard alone", async ({ page }) => {
    const owner = createFreshOwner();
    addVocabularyTerms(owner.id, ["Alpha"]);
    await signIn(page, owner);
    await openVocabulary(page);
    await page.getByText("Add words", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Words to add").focus();
    await page.keyboard.type("Keyboard word");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Add", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(words(page)).toHaveText(["Alpha", "Keyboard word"]);
  });

  test("shows words as text: markup in a word is never interpreted", async ({ page }) => {
    const owner = createFreshOwner();
    await signIn(page, owner);
    await openVocabulary(page);
    await addWords(page, "<img src=x onerror=alert(1)>, <b>bold</b>");
    await expect(words(page)).toHaveText(["<img src=x onerror=alert(1)>", "<b>bold</b>"]);
    await expect(page.locator("main b")).toHaveCount(0);
    await expect(page.locator("main img")).toHaveCount(0);
  });

  test("a word with a dot or symbol says in words that transcripts will not auto-correct it, and still counts", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    addVocabularyTerms(owner.id, ["SALSA", "Node.js", "C++", "L'Oréal", "Projet 2026"]);
    await signIn(page, owner);
    await openVocabulary(page);
    const note = "Not auto-corrected in transcripts";
    for (const term of ["Node.js", "C++"]) {
      await expect(wordRow(page, term)).toContainText(note);
    }
    for (const term of ["SALSA", "L'Oréal", "Projet 2026"]) {
      await expect(wordRow(page, term)).not.toContainText(note);
    }
    // Still accepted, still sent to the recogniser, and not part of the "does not fit" count.
    await expect(page.getByText("5 of 5 terms are used by the speech recogniser.")).toBeVisible();
    await expect(page.getByText("Not sent", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Not auto-corrected in transcripts" \(it has a dot/)).toBeVisible();
  });

  test("a word that cannot be auto-corrected is marked in the left-out group too, with both notes", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    const many = Array.from({ length: 120 }, (_, i) => `Project${String(i).padStart(3, "0")}`);
    addVocabularyTerms(owner.id, [...many, "Last.word"]);
    await signIn(page, owner);
    await openVocabulary(page);
    const row = wordRow(page, "Last.word");
    await expect(row).toContainText("Not sent");
    await expect(row).toContainText("Not auto-corrected in transcripts");
  });

  test("each owner sees only their own words", async ({ browser }) => {
    const a = createFreshOwner();
    const b = createFreshOwner();
    addVocabularyTerms(a.id, ["Only for A"]);
    addVocabularyTerms(b.id, ["Only for B"]);
    for (const [owner, mine, theirs] of [
      [a, "Only for A", "Only for B"],
      [b, "Only for B", "Only for A"],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, owner);
      await openVocabulary(page);
      await expect(words(page)).toHaveText([mine]);
      await expect(page.getByRole("main")).not.toContainText(theirs);
      await context.close();
    }
  });

  test("the seeded owners have different demo words", async ({ browser }) => {
    for (const [email, mine, theirs] of [
      ["ada@example.test", "SALSA", "Kestrel"],
      ["ben@example.test", "Kestrel", "SALSA"],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, { id: "", email });
      await openVocabulary(page);
      await expect(words(page).filter({ hasText: mine })).toHaveCount(1);
      await expect(words(page).filter({ hasText: theirs })).toHaveCount(0);
      await context.close();
    }
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("add, paste several, see the counter, validate and remove with plain forms", async ({
    page,
  }) => {
    const owner = createFreshOwner();
    await signIn(page, owner);
    await openVocabulary(page);

    // Empty list: the field is already open, so nothing needs a script.
    await page.getByLabel("Words to add").fill("SALSA\nSitetracker, Acme");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Words added");
    await expect(words(page)).toHaveText(["SALSA", "Sitetracker", "Acme"]);
    await expect(page.getByText("3 of 3 terms are used by the speech recogniser.")).toBeVisible();

    // A disclosure is native: it opens without a script.
    await page.getByText("Add words", { exact: true }).click();
    await page.getByLabel("Words to add").fill("--bad");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("cannot start with a dash");
    await expect(page.getByLabel("Words to add")).toHaveValue("--bad");

    await wordRow(page, "Sitetracker")
      .getByRole("button", { name: /^Remove/ })
      .click();
    await expect(page.getByRole("status")).toHaveText("Word removed.");
    await expect(words(page)).toHaveText(["SALSA", "Acme"]);
    expect(vocabularyTerms(owner.id).map((t) => t.term)).toEqual(["SALSA", "Acme"]);
  });

  test("the budget message and the left-out words are rendered by the server", async ({ page }) => {
    const owner = createFreshOwner();
    addVocabularyTerms(
      owner.id,
      Array.from({ length: 100 }, (_, i) => `Longer project name ${String(i).padStart(3, "0")}`),
    );
    await signIn(page, owner);
    await openVocabulary(page);
    await expect(page.locator(".vocabulary-status")).toContainText("do not fit and are left out.");
    await expect(page.getByRole("heading", { level: 3, name: "Left out" })).toBeVisible();
    await expect(page.getByText("Not sent", { exact: true }).first()).toBeVisible();
  });
});
