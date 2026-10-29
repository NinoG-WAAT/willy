import { expect, test, type Page } from "@playwright/test";
import { uniqueWord } from "../support/unique-word";

const PASSWORD = "willy-dev-password";

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

async function createNote(page: Page, title: string, agenda: string): Promise<void> {
  await page.goto("/meetings/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill("2030-05-14");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("Agenda (optional)").fill(agenda);
  await page.getByRole("button", { name: "Create note" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Note created" })).toBeVisible();
}

const search = async (page: Page, q: string) => {
  await page.goto(`/search?q=${encodeURIComponent(q)}`);
};

test("signed-out visitors are sent to sign-in for search and export", async ({ page }) => {
  await page.goto("/search?q=roadmap");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsearch%3Fq%3Droadmap$/);
  const response = await page.request.get("/meetings/meeting-a-published/export.md", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
});

test.describe("search", () => {
  test("finds notes with highlighted matches, opens a result, and survives a refresh", async ({
    page,
  }, info) => {
    const word = uniqueWord(info.project.name);
    await signIn(page, "ada@example.test");
    await createNote(page, `Strategy ${word}`, `We should discuss ${word} pricing`);

    await page.goto("/");
    await page.getByRole("search").getByLabel("Search your notes").fill(word);
    await page.getByRole("search").getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(new RegExp(`/search\\?q=${word}`));
    await expect(page).toHaveTitle(new RegExp(`Search: ${word}`));
    await expect(page.getByRole("status").filter({ hasText: "result" })).toContainText(
      `1 result for "${word}"`,
    );
    const hit = page.getByRole("listitem").filter({ hasText: `Strategy ${word}` });
    await expect(hit.locator("mark").first()).toHaveText(word);
    await expect(hit).toContainText("Title, agenda or rough notes");

    await page.reload();
    await expect(hit).toBeVisible();

    await hit.getByRole("link", { name: /^Open/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Strategy ${word}` })).toBeVisible();
  });

  test("finds words from rough notes saved after the meeting was created", async ({
    page,
  }, info) => {
    const word = uniqueWord(info.project.name);
    await signIn(page, "ada@example.test");
    await createNote(page, `Notes ${word}`, "plain agenda");
    await page.getByRole("link", { name: new RegExp(`Start note for Notes ${word}`) }).click();
    await page.getByLabel("Your notes (saved as you type)").fill(`we agreed on ${word}ish terms`);
    await expect(page.locator("#notes-status")).toContainText("Saved at");
    await search(page, word);
    await expect(page.getByRole("listitem").filter({ hasText: `Notes ${word}` })).toBeVisible();
  });

  test("searches the owner's seeded summary, decisions and action items", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await search(page, "pricing deck");
    const hits = page.getByRole("listitem").filter({ hasText: "Weekly sync with Grace" });
    await expect(hits.first()).toBeVisible();
    await expect(hits.first().locator("mark").first()).toBeVisible();
    await expect(hits.first().getByRole("link", { name: /^Open/ })).toHaveAttribute(
      "href",
      /^\/meetings\/meeting-a-published\/review\?q=/,
    );
  });

  test("never shows another owner's notes", async ({ page, browser }) => {
    await signIn(page, "ada@example.test");
    await search(page, "acquisition");
    await expect(page.getByText(/No results for/)).toBeVisible();
    await expect(page.getByText("Ben's confidential roadmap review")).toHaveCount(0);

    const ben = await browser.newPage();
    await signIn(ben, "ben@example.test");
    await search(ben, "acquisition");
    await expect(ben.getByText("Ben's confidential roadmap review").first()).toBeVisible();
    await ben.close();
  });

  test("explains an empty search, a missing query and a miss", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await page.goto("/search");
    await expect(
      page.getByRole("heading", { name: "Find something you wrote or decided" }),
    ).toBeVisible();

    await search(page, "   ");
    await expect(page.locator(".field-error")).toContainText("Enter at least one word");
    await expect(page.getByLabel("Search your notes")).toHaveAttribute("aria-invalid", "true");

    await search(page, "xyzzynotthere");
    await expect(page.getByText('No results for "xyzzynotthere"')).toBeVisible();
  });

  test("treats search syntax and markup as plain words", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await search(page, `roadmap" OR "x <script>alert(1)</script> title:beta *`);
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
    await expect(page.locator("main script")).toHaveCount(0);
    expect(await page.title()).not.toContain("<script>");
  });

  test("works on a phone without sideways scrolling", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await search(page, "roadmap");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("Markdown export", () => {
  test("downloads the owner's note with decisions and action items, names only", async ({
    page,
  }) => {
    await signIn(page, "ada@example.test");
    const response = await page.request.get("/meetings/meeting-a-published/export.md");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/markdown");
    expect(response.headers()["content-disposition"]).toMatch(
      /^attachment; filename="[a-z0-9-]+\.md"$/,
    );
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    const body = await response.text();
    expect(body).toContain("# Weekly sync with Grace");
    expect(body).toContain("Ship the beta in November.");
    expect(body).toContain("Send the pricing deck");
    expect(body).toContain("Grace Hopper");
    expect(body).not.toContain("@example.test");
  });

  test("the search result and the live note both offer a working download", async ({
    page,
  }, info) => {
    const word = uniqueWord(info.project.name);
    await signIn(page, "ada@example.test");
    await createNote(page, `Download ${word}`, `agenda ${word}`);
    await search(page, word);
    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: /^Export Markdown/ }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^download-zork[a-z0-9]*-2030-05-14\.md$/);

    await page.getByRole("link", { name: /^Open/ }).click();
    await expect(page.getByRole("link", { name: /Export as Markdown/ })).toHaveAttribute(
      "href",
      /\/export\.md$/,
    );
  });

  test("hostile text in a note is exported as inert text", async ({ page }, info) => {
    const word = uniqueWord(info.project.name);
    await signIn(page, "ada@example.test");
    await createNote(
      page,
      `# Pwned [x](javascript:alert(1)) ${word}`,
      "<script>alert(1)</script>\n=cmd|' /C calc'!A0\n- fake list",
    );
    await search(page, word);
    const href = await page.getByRole("link", { name: /^Export Markdown/ }).getAttribute("href");
    const body = await (await page.request.get(href ?? "")).text();
    for (const line of body.split("\n")) {
      expect(line).not.toMatch(/(^|[^\\])[<>]/);
      expect(line).not.toMatch(/\]\(/);
      expect(line).not.toMatch(/^(=|\+|@|- fake)/);
    }
    expect(body.split("\n")[0]).toMatch(/^# \\# Pwned/);
  });

  test("another owner's meeting and a guessed id are plain 404s", async ({ page }) => {
    await signIn(page, "ada@example.test");
    expect((await page.request.get("/meetings/meeting-b-published/export.md")).status()).toBe(404);
    expect((await page.request.get("/meetings/does-not-exist/export.md")).status()).toBe(404);
    expect((await page.request.get("/meetings/meeting-a-deleting/export.md")).status()).toBe(404);
  });
});
