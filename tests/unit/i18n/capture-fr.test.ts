import { describe, expect, it } from "vitest";
import { icsProblemMessage, skippedMessage } from "../../../src/app/calendar/ics-messages";
import { noticeMessage, problemMessage } from "../../../src/app/meetings/messages";
import { normalizeAttendees } from "../../../src/domain/meetings/attendee";
import {
  CONSENT_STATEMENT,
  consentStatement,
} from "../../../src/domain/meetings/consent-statement";
import { normalizeNewMeeting } from "../../../src/domain/meetings/new-meeting";
import { normalizeRoughNotes } from "../../../src/domain/meetings/rough-notes";
import { inLocale } from "../../support/locale";

/**
 * French wording of the new-note, live-note and calendar-import area (#119). The English text is
 * covered by the existing tests of each module; these check the French the owner reads, with the
 * glossary of docs/I18N.md (réunion, participant, consentement, enregistrement).
 */

const NBSP = " ";
const fr = <T>(fn: () => T): T => inLocale("fr", fn);

const valid = {
  title: "Point hebdo",
  date: "2026-11-03",
  time: "09:00",
  timezone: "Europe/Paris",
  durationMinutes: "45",
  agenda: "",
  attendees: "",
};

const messagesOf = (result: ReturnType<typeof normalizeNewMeeting>): Record<string, string> =>
  result.ok ? {} : Object.fromEntries(result.error.map((e) => [e.field, e.message]));

describe("the consent statement in French", () => {
  it("keeps the exact meaning: the owner told every participant, and has their consent", () => {
    const text = fr(consentStatement);
    expect(text).toBe(
      "J’ai informé chaque participant que cette réunion sera enregistrée et transcrite, et j’ai obtenu son consentement.",
    );
    // The three promises of the English statement are all still there.
    expect(text).toMatch(/chaque participant/);
    expect(text).toMatch(/enregistrée et transcrite/);
    expect(text).toMatch(/consentement/);
  });

  it("is the English text in English, and the constant used for the version is unchanged", () => {
    expect(consentStatement()).toBe(CONSENT_STATEMENT);
    expect(CONSENT_STATEMENT).toContain("every participant");
  });
});

describe("new-note validation in French", () => {
  it("says what to fix, in the formal register", () => {
    const messages = messagesOf(
      fr(() =>
        normalizeNewMeeting({
          ...valid,
          title: "",
          date: "pas une date",
          time: "pas une heure",
          timezone: "Mars/Olympus",
          durationMinutes: "2",
        }),
      ),
    );
    expect(messages).toMatchObject({
      title: "Saisissez un titre pour la réunion.",
      date: "Saisissez une date valide.",
      time: "Saisissez une heure valide.",
      timezone: "Choisissez un fuseau horaire dans la liste.",
      duration: "La durée doit être comprise entre 5 et 480 minutes.",
    });
  });

  it("states the length limits with the number in place", () => {
    const messages = messagesOf(
      fr(() => normalizeNewMeeting({ ...valid, title: "t".repeat(201), agenda: "a".repeat(2001) })),
    );
    expect(messages["title"]).toBe("Un titre ne peut pas dépasser 200 caractères.");
    expect(messages["agenda"]).toBe("L’ordre du jour ne peut pas dépasser 2000 caractères.");
  });

  it("explains a time that does not exist because the clocks move forward", () => {
    const messages = messagesOf(
      fr(() => normalizeNewMeeting({ ...valid, date: "2026-03-29", time: "02:30" })),
    );
    expect(messages["time"]).toBe(
      "Cette heure n’existe pas dans ce fuseau horaire (les horloges avancent). Choisissez une autre heure.",
    );
  });

  it("reports attendee problems in French and never claims consent", () => {
    const tooLong = fr(() => normalizeAttendees([{ name: "x".repeat(101), email: "" }]));
    expect(tooLong).toEqual({
      ok: false,
      error: {
        field: "attendees",
        message: "Le nom d’un participant ne peut pas dépasser 100 caractères.",
      },
    });
    const badEmail = fr(() => normalizeAttendees([{ name: "Ada", email: "pas-un-mail" }]));
    expect(badEmail).toEqual({
      ok: false,
      error: {
        field: "attendees",
        message: `«${NBSP}pas-un-mail${NBSP}» n’est pas une adresse e-mail valide.`,
      },
    });
  });

  it("keeps the rough notes limit message in French", () => {
    expect(fr(() => normalizeRoughNotes("x".repeat(100_001)))).toEqual({
      ok: false,
      error: {
        field: "rough_notes",
        message: "Les notes ne peuvent pas dépasser 100000 caractères.",
      },
    });
  });
});

describe("calendar import messages in French", () => {
  it("translates every refusal the same fixed way, and still ignores unknown codes", () => {
    expect(fr(() => icsProblemMessage("no_input"))).toBe(
      "Choisissez un fichier .ics ou collez le texte du calendrier.",
    );
    expect(fr(() => icsProblemMessage("too_large"))).toBe(
      "Ce calendrier dépasse 1 Mo. Exportez une période plus courte et réessayez.",
    );
    expect(fr(() => icsProblemMessage("malformed"))).toBe(fr(() => icsProblemMessage("too_deep")));
    expect(fr(() => icsProblemMessage("constructor"))).toBeNull();
    expect(fr(() => icsProblemMessage(null))).toBeNull();
  });

  it("writes a skipped event as one sentence, with the title between guillemets", () => {
    expect(fr(() => skippedMessage("missing_start", "Point hebdo"))).toBe(
      `«${NBSP}Point hebdo${NBSP}» n’a pas d’heure de début.`,
    );
    expect(fr(() => skippedMessage("missing_start", null))).toBe(
      "Un événement n’a pas d’heure de début.",
    );
  });

  it("gives every skip code a French sentence for a titled and an untitled event", () => {
    for (const code of [
      "bad_uid",
      "missing_start",
      "bad_start",
      "bad_end",
      "unknown_timezone",
      "end_before_start",
      "invalid_event",
      "duplicate",
    ] as const) {
      expect(
        fr(() => skippedMessage(code, "Réunion")),
        code,
      ).toMatch(/^«/);
      expect(
        fr(() => skippedMessage(code, null)),
        code,
      ).toMatch(/^Un événement /);
    }
  });

  it("counts imported meetings with the French plural (0 and 1 are singular)", () => {
    const imported = (query: string): string | null =>
      fr(() => noticeMessage(new URLSearchParams(query)));
    expect(imported("notice=imported&new=1&existing=0")).toBe(
      "1 nouvelle réunion importée. 0 événement figurait déjà dans votre liste.",
    );
    expect(imported("notice=imported&new=3&existing=2")).toBe(
      "3 nouvelles réunions importées. 2 événements figuraient déjà dans votre liste.",
    );
    expect(imported("notice=ics_imported&new=2&existing=1")).toBe(
      "2 nouvelles réunions importées depuis le fichier de calendrier. 1 événement figurait déjà dans votre liste.",
    );
    expect(imported("notice=imported&new=0&existing=0")).toBe(
      "Votre calendrier n’a aucun événement à venir à importer.",
    );
    expect(imported("notice=created")).toBe("Note créée. Elle apparaît sous « À venir ».");
  });

  it("answers a tampered count with a plain French sentence, never echoing it", () => {
    expect(fr(() => noticeMessage(new URLSearchParams("notice=ics_imported&new=%3Cb%3E")))).toBe(
      "Import du fichier de calendrier terminé.",
    );
  });

  it("explains each calendar problem and what to do next", () => {
    expect(fr(() => problemMessage("calendar_not_connected"))).toBe(
      "Votre calendrier n’est pas connecté : les événements ne peuvent pas être importés. Vous pouvez toujours créer une note manuellement.",
    );
    expect(fr(() => problemMessage("calendar_busy"))).toBe(
      "Le service de calendrier nous a demandé de ralentir. Patientez une minute et réessayez.",
    );
    expect(fr(() => problemMessage("calendar_unavailable"))).toMatch(/vos notes sont en sécurité/);
  });
});
