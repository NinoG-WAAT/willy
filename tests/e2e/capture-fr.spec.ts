import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { installFakeMicrophone } from "../support/fake-microphone";
import { DEV_PASSWORD, createFreshOwner } from "../support/journey-db";

/**
 * The new note form, the live note and the calendar file import in French (#119), on the server
 * whose default language is French (second server in playwright.config.ts, strict mode on: a
 * `t()` without a French entry would turn a page into an error page). Every owner is brand new.
 * The shell and the inbox are converted by their own packages, so these tests find links by
 * their address and text content, never by words those packages will translate.
 */

const baseURL = process.env["E2E_FR_BASE_URL"];
test.use({ ...(baseURL ? { baseURL } : {}) });

const expect = baseExpect.configure({ timeout: 15_000 });

const FIXTURE_PATH = "tests/fixtures/ics/outlook-week.ics";
const CONSENT =
  "J’ai informé chaque participant que cette réunion sera enregistrée et transcrite, et j’ai obtenu son consentement.";

async function signIn(page: Page): Promise<void> {
  const owner = createFreshOwner("fr");
  await page.goto("/sign-in");
  await page.getByLabel("Adresse e-mail").fill(owner.email);
  await page.getByLabel("Mot de passe").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL("/");
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const htmlLang = (page: Page) => page.locator("html").getAttribute("lang");
const unique = (label: string) => `${label} ${String(Date.now())}`;

/** Fills the French new-note form with valid values (the title is the only variable). */
async function fillNewNote(page: Page, title: string): Promise<void> {
  await page.goto("/meetings/new");
  await page.getByLabel("Titre", { exact: true }).fill(title);
  await page.getByLabel("Date", { exact: true }).fill("2030-05-14");
  await page.getByLabel("Heure de début").fill("09:00");
  await page.getByLabel("Participants (facultatif)").fill("Grace Hopper <grace@example.com>");
  await page.getByLabel("Ordre du jour (facultatif)").fill("Revue de la feuille de route");
}

/** Creates a note through the real form and opens it from the inbox. */
async function openNewNote(page: Page, title: string): Promise<void> {
  await fillNewNote(page, title);
  await page.getByRole("button", { name: "Créer la note" }).click();
  await expect(page).toHaveURL(/\/\?notice=created$/);
  await page.locator("a[href^='/meetings/']").filter({ hasText: title }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test.describe("new note form", () => {
  test("every word of the form is French, and creating a note says so", async ({ page }) => {
    await signIn(page);
    await page.goto("/meetings/new");
    expect(await htmlLang(page)).toBe("fr");
    await expect(page).toHaveTitle("Nouvelle note - Willycrumbs");
    await expect(page.getByRole("heading", { level: 1, name: "Nouvelle note" })).toBeVisible();
    await expect(page.getByText(/Rien n’est enregistré maintenant/)).toBeVisible();
    for (const label of [
      "Titre",
      "Date",
      "Heure de début",
      "Durée (minutes)",
      "Fuseau horaire",
      "Ordre du jour (facultatif)",
      "Participants (facultatif)",
      "Modèle",
    ]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    // The help text names the format and says listing someone is not their consent.
    await expect(
      page.getByText(/Ajouter quelqu’un ici n’enregistre pas son consentement/),
    ).toBeVisible();
    await expect(page.getByText("Structure intégrée")).toBeAttached();
    await expect(page.getByRole("link", { name: "Gérer les modèles" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Annuler" })).toBeVisible();
    await noHorizontalScroll(page);

    await fillNewNote(page, unique("Appel client"));
    await page.getByRole("button", { name: "Créer la note" }).click();
    await expect(page).toHaveURL(/\/\?notice=created$/);
    await expect(page.getByRole("status").filter({ hasText: "Note créée." })).toContainText(
      "Elle apparaît sous « À venir ».",
    );
  });

  test("a rejected form explains each problem in French and keeps what was typed", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/meetings/new");
    // Turn off the browser's own validation so the server's French messages are what shows.
    await page.evaluate(() => {
      document.querySelector("form.form")?.setAttribute("novalidate", "");
    });
    // The browser fills today's date and time in by itself; blank them like a user who cleared them.
    await page.getByLabel("Date", { exact: true }).fill("");
    await page.getByLabel("Heure de début").fill("");
    await page.getByLabel("Durée (minutes)").fill("2");
    await page.getByLabel("Participants (facultatif)").fill("Ada <pas-un-mail>");
    await page.getByRole("button", { name: "Créer la note" }).click();

    const summary = page.getByRole("alert");
    await expect(summary).toBeVisible();
    await expect(page.locator("#title-error")).toHaveText("Saisissez un titre pour la réunion.");
    await expect(page.locator("#date-error")).toHaveText("Saisissez une date valide.");
    await expect(page.locator("#time-error")).toHaveText("Saisissez une heure valide.");
    await expect(page.locator("#duration-error")).toHaveText(
      "La durée doit être comprise entre 5 et 480 minutes.",
    );
    await expect(page.locator("#attendees-error")).toHaveText(
      "« pas-un-mail » n’est pas une adresse e-mail valide.",
    );
    await expect(page.getByLabel("Durée (minutes)")).toHaveValue("2");
    await noHorizontalScroll(page);
  });
});

test.describe("live note", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeMicrophone(page);
  });

  test("consent, recording, pause and the rough notes autosave are all in French", async ({
    page,
  }) => {
    test.slow();
    await signIn(page);
    const title = unique("Revue produit");
    await openNewNote(page, title);
    expect(await htmlLang(page)).toBe("fr");
    await expect(page.getByRole("heading", { level: 2, name: "Enregistrement" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Notes brutes" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Participants" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Ordre du jour" })).toBeVisible();
    await expect(page.getByText("Grace Hopper")).toBeVisible();
    await expect(page.getByText("Revue de la feuille de route")).toBeVisible();
    await noHorizontalScroll(page);

    // The statement keeps its meaning, and the server still needs the tick.
    await expect(page.getByLabel(CONSENT)).toBeVisible();
    await expect(page.getByText(/Willycrumbs n’enregistre jamais le consentement/)).toBeVisible();
    const start = page.getByRole("button", { name: "Démarrer l’enregistrement" });
    await expect(start).toBeDisabled();
    await page.getByLabel(CONSENT).check();
    await expect(start).toBeEnabled();
    await start.click();

    await expect(page.locator("#rec-label")).toHaveText("Enregistrement en cours");
    await expect(page.locator("#rec-detail")).toContainText(
      "Le microphone est activé dans ce navigateur.",
    );
    await expect(page.getByText("Niveau d’entrée du microphone")).toBeAttached();
    await expect(page.locator("#upload-status")).toHaveText(
      "Tout l’audio enregistré a été envoyé.",
    );
    await noHorizontalScroll(page);

    // Autosave status, in French, with the time in the page's language.
    await page
      .getByLabel("Vos notes (enregistrées au fil de la saisie)")
      .fill("Décision : on livre en mai");
    await expect(page.locator("#notes-status")).toContainText(/Enregistré à \d{2}:\d{2}\./);

    await page.getByRole("button", { name: "Mettre en pause" }).click();
    await expect(page.locator("#rec-label")).toHaveText("Enregistrement en pause");
    await expect(page.locator("#rec-detail")).toHaveText(
      "L’enregistrement est en pause. Rien n’est enregistré.",
    );
    await expect(page.getByRole("button", { name: "Reprendre" })).toBeVisible();
    await expect(
      page.getByText(/Vous ne pourrez pas reprendre cet enregistrement ensuite/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Arrêter l’enregistrement" })).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("a blocked microphone is explained in French and the notes still work", async ({ page }) => {
    await signIn(page);
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
    await openNewNote(page, unique("Micro bloqué"));
    await page.getByLabel(CONSENT).check();
    await page.getByRole("button", { name: "Démarrer l’enregistrement" }).click();
    await expect(page.locator("#capture-problem-text")).toHaveText(
      /L’accès au microphone a été bloqué\. Autorisez le microphone pour ce site/,
    );
    await expect(page.getByRole("button", { name: "Réessayer le microphone" })).toBeVisible();
    await expect(page.locator("#rec-detail")).toHaveText(
      "Aucun enregistrement dans ce navigateur.",
    );
    await noHorizontalScroll(page);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("starting without ticking the consent is refused by the server, in French", async ({
      page,
    }) => {
      await signIn(page);
      await openNewNote(page, unique("Sans JavaScript"));
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" && /\/meetings\/[^/]+$/.test(new URL(r.url()).pathname),
      );
      await page.getByRole("button", { name: "Démarrer l’enregistrement" }).click();
      expect((await response).status()).toBe(422);
      await expect(page.getByRole("alert")).toHaveText(
        "L’enregistrement n’a pas démarré. Cochez d’abord la déclaration de consentement : rien n’est enregistré tant que vous ne l’avez pas confirmée.",
      );
      // The text sits inside <noscript>, which neither text queries nor textContent expose.
      expect(await page.content()).toContain(
        "L’enregistrement audio nécessite JavaScript. Sans lui, vous pouvez quand même prendre des notes ci-dessous.",
      );
    });
  });
});

test.describe("calendar file import", () => {
  test("the form, the preview and the confirmation are French", async ({ page }) => {
    await signIn(page);
    await page.goto("/meetings/import/ics");
    expect(await htmlLang(page)).toBe("fr");
    await expect(page).toHaveTitle("Importer depuis un fichier ICS - Willycrumbs");
    await expect(
      page.getByRole("heading", { level: 1, name: "Importer depuis un fichier ICS" }),
    ).toBeVisible();
    await expect(page.getByText("Comment exporter depuis Outlook ou Teams")).toBeVisible();
    await noHorizontalScroll(page);

    await page.getByLabel("Fichier de calendrier (.ics, 1 Mo maximum)").setInputFiles(FIXTURE_PATH);
    await page.getByRole("button", { name: "Prévisualiser les événements" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Aperçu" })).toBeVisible();
    const preview = page.getByRole("status").filter({ hasText: "6 événements trouvés" });
    await expect(preview).toContainText("Importables : 5.");
    await expect(preview).toContainText("Rien n’a encore été importé.");
    await expect(page.getByText(/1 série récurrente n’a pas été développée/)).toBeVisible();
    await expect(page.getByText("Annulé dans le calendrier : non importé")).toBeVisible();
    await expect(page.getByText("2 participants").first()).toBeVisible();
    await expect(page.getByText(/toute la journée/).first()).toBeVisible();
    await expect(page.getByText(/\(\d+ min\)/).first()).toBeVisible();
    await noHorizontalScroll(page);

    await page.getByRole("button", { name: "Importer les événements sélectionnés" }).click();
    await expect(page).toHaveURL(/\/\?notice=ics_imported/);
    await expect(
      page.getByRole("status").filter({ hasText: "5 nouvelles réunions importées" }),
    ).toContainText("0 événement figurait déjà dans votre liste.");
  });

  test("a skipped event is one French sentence with its title", async ({ page }) => {
    await signIn(page);
    await page.goto("/meetings/import/ics");
    const calendar = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:sans-heure-1",
      "SUMMARY:Sans heure",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:avec-heure-1",
      "SUMMARY:Avec heure",
      "DTSTART:20261103T080000Z",
      "DTEND:20261103T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    await page.getByLabel("Ou collez le texte du calendrier").fill(calendar);
    await page.getByRole("button", { name: "Prévisualiser les événements" }).click();
    await expect(page.getByText("1 événement a été ignoré :")).toBeVisible();
    await expect(page.getByText("« Sans heure » n’a pas d’heure de début.")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Avec heure" })).toBeChecked();
  });

  test("a refused file gets a French reason and nothing from the file is echoed", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/meetings/import/ics");
    await page.getByRole("button", { name: "Prévisualiser les événements" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Choisissez un fichier .ics ou collez le texte du calendrier.",
    );
    await page
      .getByLabel("Ou collez le texte du calendrier")
      .fill("<html>bonjour</html> notes collées");
    await page.getByRole("button", { name: "Prévisualiser les événements" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Cela ne ressemble pas à un fichier de calendrier (.ics).",
    );
    await expect(page.getByText("notes collées")).toHaveCount(0);
    await noHorizontalScroll(page);
  });
});

test.describe("accessibility in French", () => {
  const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
  const violations = async (page: Page) =>
    (await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations.map((v) => v.id);

  test("the new note form, the live note and the import have no violations", async ({ page }) => {
    await signIn(page);
    await page.goto("/meetings/new");
    expect(await violations(page)).toEqual([]);
    await page.goto("/meetings/import/ics");
    expect(await violations(page)).toEqual([]);
    await openNewNote(page, unique("Accessibilité"));
    expect(await violations(page)).toEqual([]);
  });
});
