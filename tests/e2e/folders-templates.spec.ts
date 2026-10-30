import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = "willy-dev-password";

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

/** Unique per test, project and run: desktop and phone projects share one seeded database. */
function unique(label: string, info: TestInfo): string {
  return `${label} ${info.project.name} ${String(info.workerIndex)} ${String(Date.now())}`;
}

// In the page, not the shell: the sidebar lists the same folders (#70).
function row(page: Page, name: string) {
  return page.getByRole("main").getByRole("listitem").filter({ hasText: name });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("signed-out visitors are sent to sign-in for folders and templates", async ({ page }) => {
  await page.goto("/folders");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Ffolders$/);
  await page.goto("/settings/templates");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings%2Ftemplates$/);
});

test.describe("folders", () => {
  test("create, rename and delete a folder; changes survive a refresh", async ({ page }, info) => {
    const name = unique("Folder", info);
    const renamed = `${name} renamed`;
    await signIn(page, "ada@example.test");
    await page.goto("/folders");
    await expect(page).toHaveTitle("Folders - Willycrumbs");
    await noHorizontalScroll(page);

    await page.getByLabel("Folder name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Create folder" }).click();
    await expect(page.getByRole("status")).toHaveText("Folder created.");
    await expect(row(page, name)).toContainText("0 notes");
    await page.reload();
    await expect(row(page, name)).toBeVisible();

    await row(page, name).getByLabel(`New name for folder ${name}`).fill(renamed);
    await row(page, name)
      .getByRole("button", { name: /^Rename/ })
      .click();
    await expect(page.getByRole("status")).toHaveText("Folder renamed.");
    await expect(row(page, renamed)).toBeVisible();

    await row(page, renamed)
      .getByRole("link", { name: /^Delete/ })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Delete folder" })).toBeVisible();
    await expect(page.getByText("Scope: only the folder itself is removed")).toBeVisible();
    await page.getByRole("button", { name: "Delete folder" }).click();
    await expect(page.getByRole("status")).toHaveText("Folder deleted.");
    await expect(row(page, renamed)).toHaveCount(0);
  });

  test("shows validation feedback for a blank and a duplicate name", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await page.goto("/folders");

    await page.getByLabel("Folder name", { exact: true }).fill("   ");
    await page.getByRole("button", { name: "Create folder" }).click();
    await expect(page.locator(".field-error")).toContainText("Enter a folder name.");
    await expect(page.getByLabel("Folder name", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await page.getByLabel("Folder name", { exact: true }).fill("board UPDATES");
    await page.getByRole("button", { name: "Create folder" }).click();
    await expect(page.locator(".field-error")).toContainText("already have a folder");
  });

  test("a folder that contains notes cannot be deleted", async ({ page }) => {
    await signIn(page, "ada@example.test");
    await page.goto("/folders");
    await row(page, "Board updates")
      .getByRole("link", { name: /^Delete/ })
      .click();
    await expect(page.getByText("This folder contains 1 note.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete folder" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to folders" })).toBeVisible();
  });

  test("another owner's folder id is a plain 404", async ({ page }) => {
    await signIn(page, "ada@example.test");
    const response = await page.goto("/folders/folder-b-board/delete");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
    const guessed = await page.goto("/folders/does-not-exist/delete");
    expect(guessed?.status()).toBe(404);
  });
});

test.describe("templates", () => {
  test("create a template from the built-in layout, edit it, and delete it", async ({
    page,
  }, info) => {
    const name = unique("Template", info);
    await signIn(page, "ada@example.test");
    await page.goto("/settings/templates");
    await expect(page).toHaveTitle("Templates - Willycrumbs");
    await noHorizontalScroll(page);

    await page.getByRole("link", { name: "New template" }).click();
    await expect(page.locator("#section-0-heading")).toHaveValue("Summary");
    await page.getByLabel("Template name").fill(name);
    await page.locator("#section-3-heading").fill("Customer quotes");
    await page.locator("#section-3-prompt").fill("Quote customers word for word.");
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "Create template" }).click();

    await expect(page.getByRole("status")).toHaveText("Template created.");
    await expect(row(page, name)).toContainText("4 sections");
    await expect(row(page, name)).toContainText("Customer quotes");

    await row(page, name).getByRole("link", { name: /^Edit/ }).click();
    await expect(page.locator("#section-3-heading")).toHaveValue("Customer quotes");
    await page.locator("#section-3-heading").fill("Quotes");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("status")).toHaveText("Template saved.");
    await page.reload();
    await expect(row(page, name)).toContainText("Quotes");

    await row(page, name)
      .getByRole("link", { name: /^Delete/ })
      .click();
    await expect(page.getByText("No meeting uses this template.")).toBeVisible();
    await page.getByRole("button", { name: "Delete template" }).click();
    await expect(page.getByRole("status")).toHaveText("Template deleted.");
    await expect(row(page, name)).toHaveCount(0);
  });

  test("shows every validation problem at once and keeps what was typed", async ({
    page,
  }, info) => {
    const name = unique("Invalid", info);
    await signIn(page, "ada@example.test");
    await page.goto("/settings/templates/new");

    await page.getByLabel("Template name").fill(name);
    await page.locator("#section-0-heading").fill("Same");
    await page.locator("#section-1-heading").fill("same");
    await page.locator("#section-2-heading").fill("");
    await page.locator("#section-2-prompt").fill("A prompt without a heading");
    await page.getByRole("button", { name: "Create template" }).click();

    const summary = page.getByRole("alert");
    await expect(summary).toContainText("Each section needs a different heading.");
    await expect(summary).toContainText("Give this section a heading.");
    await expect(page.locator("#section-1-heading")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#section-2-heading")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Template name")).toHaveValue(name);
    await expect(page.locator("#section-2-prompt")).toHaveValue("A prompt without a heading");
  });

  test("markup in a template is shown as text, never interpreted", async ({ page }, info) => {
    const name = unique("Markup", info);
    await signIn(page, "ada@example.test");
    await page.goto("/settings/templates/new");
    await page.getByLabel("Template name").fill(name);
    await page.locator("#section-0-heading").fill("<img src=x onerror=alert(1)>");
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(row(page, name)).toContainText("<img src=x onerror=alert(1)>");
    await expect(page.locator("main img")).toHaveCount(0);
    await row(page, name)
      .getByRole("link", { name: /^Delete/ })
      .click();
    await page.getByRole("button", { name: "Delete template" }).click();
  });

  test("the default template can be switched", async ({ page }, info) => {
    // Only one project toggles the owner-wide default, so parallel projects cannot race on it.
    test.skip(info.project.name !== "desktop", "default is owner-wide shared state");
    const name = unique("Default", info);
    await signIn(page, "ada@example.test");
    await page.goto("/settings/templates/new");
    await page.getByLabel("Template name").fill(name);
    await page.getByLabel("Use as my default template for new meetings").check();
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(row(page, name).locator(".badge")).toHaveText("Default");
    await expect(row(page, "Weekly sync").locator(".badge")).toHaveCount(0);

    await row(page, "Weekly sync")
      .getByRole("button", { name: /^Make default/ })
      .click();
    await expect(page.getByRole("status")).toHaveText("Default template updated.");
    await expect(row(page, "Weekly sync").locator(".badge")).toHaveText("Default");
    await expect(row(page, name).locator(".badge")).toHaveCount(0);

    await row(page, name)
      .getByRole("link", { name: /^Delete/ })
      .click();
    await page.getByRole("button", { name: "Delete template" }).click();
  });

  test("another owner's template id is a plain 404 for edit and delete", async ({
    browser,
  }, info) => {
    const name = unique("Bens private", info);
    const ben = await browser.newPage();
    await signIn(ben, "ben@example.test");
    await ben.goto("/settings/templates/new");
    await ben.getByLabel("Template name").fill(name);
    await ben.getByRole("button", { name: "Create template" }).click();
    const href = await row(ben, name).getByRole("link", { name: /^Edit/ }).getAttribute("href");
    expect(href).toMatch(/^\/settings\/templates\/[^/]+$/);

    const ada = await browser.newPage();
    await signIn(ada, "ada@example.test");
    expect((await ada.goto(href ?? ""))?.status()).toBe(404);
    expect((await ada.goto(`${href ?? ""}/delete`))?.status()).toBe(404);
    await ada.goto("/settings/templates");
    await expect(ada.getByText(name)).toHaveCount(0);

    await ben.goto(`${href ?? ""}/delete`);
    await ben.getByRole("button", { name: "Delete template" }).click();
    await ben.close();
    await ada.close();
  });
});

test.describe("core forms work without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("create a folder and a template with plain form posts", async ({ page }, info) => {
    const folder = unique("NoJS folder", info);
    const template = unique("NoJS template", info);
    await signIn(page, "ada@example.test");

    await page.goto("/folders");
    await page.getByLabel("Folder name", { exact: true }).fill(folder);
    await page.getByRole("button", { name: "Create folder" }).click();
    await expect(row(page, folder)).toBeVisible();
    await row(page, folder)
      .getByRole("link", { name: /^Delete/ })
      .click();
    await page.getByRole("button", { name: "Delete folder" }).click();
    await expect(row(page, folder)).toHaveCount(0);

    await page.goto("/settings/templates/new");
    await page.getByLabel("Template name").fill(template);
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(row(page, template)).toBeVisible();
    await row(page, template)
      .getByRole("link", { name: /^Delete/ })
      .click();
    await page.getByRole("button", { name: "Delete template" }).click();
    await expect(row(page, template)).toHaveCount(0);
  });
});
