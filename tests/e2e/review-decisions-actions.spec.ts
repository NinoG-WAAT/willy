import { expect, test, type Page } from "@playwright/test";
import { createFreshOwner } from "../support/journey-db";
import {
  actionItemState,
  addOutlineItems,
  createReviewMeeting,
  meetingStatus,
} from "../support/e2e-db";

/**
 * Decisions and action items as an outline (issue #98): read-only text with chips by default,
 * one item opened in place by `?edit=<id>`, a done checkbox that is a tiny form of its own, and
 * add behind a disclosure. The core of it must work without JavaScript, at 390px, and only for
 * the owner of the note.
 */

const PASSWORD = "willy-dev-password";

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  return (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
}

/**
 * A review draft with the outline items, owned by a brand-new Owner: these tests add many
 * meetings, and with the shared seeded owner they would push the seeded ones off the first page
 * of her Inbox (which other specs read).
 */
async function outlineMeeting(page: Page): Promise<string> {
  const owner = createFreshOwner();
  await signIn(page, owner.email);
  const id = await createReviewMeeting(owner.id);
  addOutlineItems(id);
  await page.goto(`/meetings/${id}/review`);
  return id;
}

test("decisions and action items are read-only text: no field, no Save, no Remove", async ({
  page,
}) => {
  const id = await outlineMeeting(page);
  for (const section of ["#decisions", "#action-items"]) {
    const area = page.locator(section);
    await expect(
      area.locator("li input[type=text], li input[type=date], li select, li textarea"),
    ).toHaveCount(0);
    await expect(area.getByRole("button", { name: /^(Save|Remove|Confirm)/ })).toHaveCount(0);
    await expect(area.locator("details.rl-add")).not.toHaveAttribute("open");
  }
  await expect(page.locator("#decisions li")).toHaveCount(3);
  await expect(page.locator("#action-items li")).toHaveCount(4);

  // Decisions: plain text with a source chip showing real times, or "Added by you".
  const decision = page.locator(`#decision-${id}-dec-1`);
  await expect(decision).toContainText("Hire a product designer in the first quarter");
  await expect(decision.getByRole("link", { name: /^Source: transcript/ })).toHaveText(
    /^\d+:\d{2}/,
  );
  await expect(page.locator(`#decision-${id}-dec-2`)).toContainText("Added by you");

  // Action items: checkbox, text, owner, due day in the meeting's zone, source.
  const venue = page.locator(`#action-${id}-act-1`);
  await expect(venue).toContainText("Book the venue for the offsite");
  await expect(venue).toContainText("Grace Hopper");
  await expect(venue).toContainText("Due Fri 13 Mar 2099");
  await expect(
    venue.getByRole("checkbox", { name: /Mark done: Book the venue/ }),
  ).not.toBeChecked();
  await expect(venue.getByRole("link", { name: /^Source: transcript/ })).toBeVisible();
  const shared = page.locator(`#action-${id}-act-2`);
  await expect(
    shared.getByRole("checkbox", { name: /Mark done: Share the pricing/ }),
  ).toBeChecked();
});

test("overdue is said in words, only for an open item past its due date", async ({ page }) => {
  const id = await outlineMeeting(page);
  const overdue = page.locator(`#action-${id}-act-3`);
  await expect(overdue.locator(".rl-chip-overdue")).toHaveText("Overdue");
  await expect(overdue).toContainText("Due Wed 15 Jan 2020");
  // Not overdue: due in 2099, and a done item (even one with no due date).
  await expect(page.locator(`#action-${id}-act-1 .rl-chip-overdue`)).toHaveCount(0);
  await expect(page.locator(`#action-${id}-act-2 .rl-chip-overdue`)).toHaveCount(0);
  // Done: no longer overdue.
  await overdue.getByRole("checkbox").check();
  await expect(page).toHaveURL(/notice=action_done#action-/);
  await expect(page.locator(`#action-${id}-act-3`)).toContainText("Due Wed 15 Jan 2020");
  await expect(page.locator(`#action-${id}-act-3 .rl-chip-overdue`)).toHaveCount(0);
});

test("Edit opens only that item, Cancel returns to the outline", async ({ page }) => {
  const id = await outlineMeeting(page);
  await page.locator(`#action-${id}-act-1`).getByRole("link", { name: /^Edit/ }).click();
  await expect(page).toHaveURL(new RegExp(`review\\?edit=${id}-act-1#action-${id}-act-1$`));
  await expect(page.locator("#action-items li input[type=text]")).toHaveCount(1);
  await expect(page.locator(`#act-text-${id}-act-1`)).toHaveValue("Book the venue for the offsite");
  await expect(page.locator(`#act-text-${id}-act-1`)).toBeFocused();
  await expect(page.locator("#decisions li input[type=text]")).toHaveCount(0);
  await expect(page.locator(`#action-${id}-act-1`).getByLabel("Done")).not.toBeChecked();
  // Remove lives only here, behind a confirmation.
  await expect(page.getByRole("button", { name: /Confirm: remove action item/ })).toBeHidden();

  await page
    .locator(`#action-${id}-act-1`)
    .getByRole("link", { name: /^Cancel/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/review#action-${id}-act-1$`));
  await expect(page.locator("#action-items li input[type=text]")).toHaveCount(0);
  await expect(page.locator(`#action-${id}-act-1`)).toContainText("Book the venue for the offsite");

  // A decision opens the same way, and an id that is not on this note opens nothing.
  await page.goto(`/meetings/${id}/review?edit=${id}-dec-1`);
  await expect(page.locator("#decisions li input[type=text]")).toHaveCount(1);
  await expect(page.locator("#action-items li input[type=text]")).toHaveCount(0);
  await page.goto(`/meetings/${id}/review?edit=${encodeURIComponent("<b>x</b>")}`);
  await expect(
    page.locator("#decisions li input[type=text], #action-items li input[type=text]"),
  ).toHaveCount(0);
  await expect(page.locator("b")).toHaveCount(0);
});

test("a rejected save keeps the item in edit mode with what was typed and the error", async ({
  page,
}) => {
  const id = await outlineMeeting(page);
  await page.goto(`/meetings/${id}/review?edit=${id}-act-1`);
  await page.locator(`#act-text-${id}-act-1`).fill("   ");
  await page.locator(`#act-owner-${id}-act-1`).selectOption({ label: "Ada Lovelace" });
  await page.locator(`#act-due-${id}-act-1`).fill("2099-04-02");
  await page.getByRole("button", { name: /Save action item/ }).click();

  await expect(page.getByRole("alert")).toContainText("not saved");
  const item = page.locator(`#action-${id}-act-1`);
  await expect(item.locator(".field-error")).toContainText("Describe the action.");
  await expect(item.locator(`#act-text-${id}-act-1`)).toHaveAttribute("aria-invalid", "true");
  await expect(item.locator(`#act-owner-${id}-act-1`)).toHaveValue(`${id}-a1`);
  await expect(item.locator(`#act-due-${id}-act-1`)).toHaveValue("2099-04-02");
  // Only this item is open; nothing was saved.
  await expect(page.locator("#action-items li input[type=text]")).toHaveCount(1);
  expect(actionItemState(`${id}-act-1`).edited).toBe(0);

  // The same for a decision.
  await page.goto(`/meetings/${id}/review?edit=${id}-dec-1`);
  await page.locator(`#decision-text-${id}-dec-1`).fill("");
  await page.getByRole("button", { name: /Save decision/ }).click();
  await expect(page.locator(`#decision-${id}-dec-1 .field-error`)).toBeVisible();
  await expect(page.locator("#decisions li input[type=text]")).toHaveCount(1);
});

test("the done checkbox ticks and unticks an action item and leaves everything else alone", async ({
  page,
}) => {
  const id = await outlineMeeting(page);
  const venue = page.locator(`#action-${id}-act-1`);
  await venue.getByRole("checkbox", { name: /Mark done: Book the venue/ }).check();
  await expect(
    page.getByRole("status").filter({ hasText: "Action item marked as done." }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`review\\?notice=action_done#action-${id}-act-1$`));
  await expect(venue.getByRole("checkbox")).toBeChecked();
  expect(actionItemState(`${id}-act-1`)).toEqual({ status: "done", edited: 0 });
  await expect(venue).toContainText("Grace Hopper");

  await venue.getByRole("checkbox").uncheck();
  await expect(page.getByRole("status").filter({ hasText: "Action item reopened." })).toBeVisible();
  await expect(venue.getByRole("checkbox")).not.toBeChecked();
  expect(actionItemState(`${id}-act-1`).status).toBe("open");
});

test("adding goes through a disclosure; a rejected add opens it with what was typed", async ({
  page,
}) => {
  const id = await outlineMeeting(page);
  const decisions = page.locator("#decisions");
  await decisions.getByText("Add a decision").click();
  await decisions.getByLabel("Decision").fill("Adopt weekly demos");
  await decisions.getByRole("button", { name: "Add decision" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Decision added." })).toBeVisible();
  await expect(page.locator("#decisions li")).toHaveCount(4);
  await expect(page.locator("#decisions")).toContainText("Adopt weekly demos");

  const actions = page.locator("#action-items");
  await actions.getByText("Add an action item").click();
  await actions.getByLabel("Action", { exact: true }).fill("Draft the demo agenda");
  await actions.locator("#new-action-owner").selectOption({ label: "Ada Lovelace" });
  await actions.locator("#new-action-due").fill("2099-05-01");
  await actions.getByRole("button", { name: "Add action item" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Action item added." })).toBeVisible();
  const added = page.locator("#action-items li", { hasText: "Draft the demo agenda" });
  await expect(added).toContainText("Ada Lovelace");
  await expect(added).toContainText("Due Fri 1 May 2099");
  await expect(added).toContainText("Added by you");

  // A bad date: the disclosure comes back open with the typed values and the error.
  await page.goto(`/meetings/${id}/review`);
  await actions.getByText("Add an action item").click();
  await actions.getByLabel("Action", { exact: true }).fill("   ");
  await actions.locator("#new-action-due").fill("2099-05-01");
  await actions.getByRole("button", { name: "Add action item" }).click();
  await expect(actions.locator("details.rl-add")).toHaveAttribute("open", "");
  await expect(actions.locator(".field-error")).toContainText("Describe the action.");
  await expect(actions.locator("#new-action-due")).toHaveValue("2099-05-01");
});

test("remove is only in the edit view, asks for confirmation and removes only that item", async ({
  page,
}) => {
  const id = await outlineMeeting(page);
  await page.goto(`/meetings/${id}/review?edit=${id}-dec-2`);
  await page.getByText("Remove this decision").click();
  await expect(page.getByText("Removes only this decision from the draft.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm: remove decision" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Decision removed" })).toBeVisible();
  await expect(page.locator("#decisions li")).toHaveCount(2);
  await expect(page.locator("#decisions")).not.toContainText("Move the launch review to Fridays");

  await page.goto(`/meetings/${id}/review?edit=${id}-act-2`);
  await page.getByText("Remove this action item").click();
  await page.getByRole("button", { name: "Confirm: remove action item" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Action item removed" })).toBeVisible();
  await expect(page.locator("#action-items li")).toHaveCount(3);
});

test("another owner cannot open an item for editing or tick it", async ({ page }) => {
  const ada = createFreshOwner();
  const ben = createFreshOwner();
  const adasId = await createReviewMeeting(ada.id);
  addOutlineItems(adasId);
  const token = await signIn(page, ben.email);
  const origin = new URL(page.url()).origin;

  // Ada's review, with or without ?edit=, is the same 404 as an unknown meeting.
  for (const path of [
    `/meetings/${adasId}/review?edit=${adasId}-act-1`,
    `/meetings/${adasId}/review?edit=${adasId}-dec-1`,
    "/meetings/does-not-exist/review?edit=x",
  ]) {
    expect((await page.goto(path))?.status()).toBe(404);
    await expect(page.locator(`#act-text-${adasId}-act-1`)).toHaveCount(0);
  }

  // On Ben's own review, Ada's item id opens nothing and leaks nothing.
  const bensId = await createReviewMeeting(ben.id);
  const own = await page.goto(`/meetings/${bensId}/review?edit=${adasId}-act-1`);
  expect(own?.status()).toBe(200);
  await expect(page.locator("#action-items li input[type=text]")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Book the venue");

  // Ticking Ada's item is a 404 through her meeting and through his own.
  for (const meeting of [adasId, bensId]) {
    const res = await page.request.post(`/meetings/${meeting}/review`, {
      headers: { origin },
      form: {
        csrf_token: token,
        intent: "set_action_item_done",
        id: `${adasId}-act-1`,
        done: "on",
      },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(404);
  }
  expect(actionItemState(`${adasId}-act-1`).status).toBe("open");
  expect(meetingStatus(adasId)).toBe("review");
});

test("a published note shows the outline without Edit, checkboxes or add", async ({ page }) => {
  await signIn(page, "ada@example.test");
  await page.goto("/meetings/meeting-a-published/review?edit=anything");
  await expect(page.locator("#decisions, #action-items").first()).toBeVisible();
  await expect(page.locator("#action-items input, #decisions li input[type=text]")).toHaveCount(0);
  await expect(
    page.locator("#action-items, #decisions").getByRole("link", { name: /^Edit/ }),
  ).toHaveCount(0);
  await expect(page.locator("details.rl-add")).toHaveCount(0);
});

test("the outline reflows at 320px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await outlineMeeting(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the done checkbox is a plain form with its own Save button, and repeating it changes nothing", async ({
    page,
  }) => {
    const id = await outlineMeeting(page);
    const venue = page.locator(`#action-${id}-act-1`);
    await venue.getByRole("checkbox", { name: /Mark done: Book the venue/ }).check();
    await venue.getByRole("button", { name: /^Save status/ }).click();
    await expect(page.getByText("Action item marked as done.")).toBeVisible();
    await expect(venue.getByRole("checkbox")).toBeChecked();
    expect(actionItemState(`${id}-act-1`)).toEqual({ status: "done", edited: 0 });

    // The same request again (a double click, a replay) is a no-op, not an error.
    const token =
      (await page.locator("input[name=csrf_token]").first().getAttribute("value")) ?? "";
    const origin = new URL(page.url()).origin;
    const again = await page.request.post(`/meetings/${id}/review`, {
      headers: { origin },
      form: { csrf_token: token, intent: "set_action_item_done", id: `${id}-act-1`, done: "on" },
      maxRedirects: 0,
    });
    expect(again.status()).toBe(303);
    expect(actionItemState(`${id}-act-1`)).toEqual({ status: "done", edited: 0 });

    // Unticked: the form sends no field, which means open again.
    await venue.getByRole("checkbox").uncheck();
    await venue.getByRole("button", { name: /^Save status/ }).click();
    await expect(page.getByText("Action item reopened.")).toBeVisible();
    expect(actionItemState(`${id}-act-1`).status).toBe("open");
  });

  test("edit, cancel, add and remove work as plain links and forms", async ({ page }) => {
    const id = await outlineMeeting(page);
    await page.locator(`#decision-${id}-dec-1`).getByRole("link", { name: /^Edit/ }).click();
    await page.locator(`#decision-text-${id}-dec-1`).fill("Hire two designers");
    await page.getByRole("button", { name: /Save decision/ }).click();
    await expect(page.getByText("Decision saved.")).toBeVisible();
    await expect(page.locator(`#decision-${id}-dec-1`)).toContainText("Hire two designers");

    await page.locator(`#action-${id}-act-1`).getByRole("link", { name: /^Edit/ }).click();
    await page
      .locator(`#action-${id}-act-1`)
      .getByRole("link", { name: /^Cancel/ })
      .click();
    await expect(page.locator("#action-items li input[type=text]")).toHaveCount(0);

    // A disclosure opens without JavaScript too.
    await page.locator("#decisions").getByText("Add a decision").click();
    await page.locator("#decisions").getByLabel("Decision").fill("Close the beta in March");
    await page.getByRole("button", { name: "Add decision" }).click();
    await expect(page.getByText("Decision added.")).toBeVisible();

    await page.goto(`/meetings/${id}/review?edit=${id}-act-3`);
    await page.getByText("Remove this action item").click();
    await page.getByRole("button", { name: "Confirm: remove action item" }).click();
    await expect(page.getByText("Action item removed from the draft.")).toBeVisible();
    await expect(page.locator("#action-items li")).toHaveCount(3);
  });
});
