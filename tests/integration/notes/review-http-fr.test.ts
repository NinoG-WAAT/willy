import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_KEYRING } from "../../../src/adapters/crypto/dev-keyring";
import { createEnvelopeCipher, parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { SqliteReviewRepository } from "../../../src/adapters/sqlite/review-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import {
  handleReviewForm,
  reviewNoticeText,
  type ReviewFormDeps,
} from "../../../src/app/notes/review-http";
import { folder, freshDb, owner } from "../../support/db-fixtures";
import { inLocale } from "../../support/locale";
import { seedReviewMeeting } from "../../support/review-fixtures";

const cipher = createEnvelopeCipher(parseKeyring(DEV_KEYRING.spec), DEV_KEYRING.activeKeyId);

let db: DatabaseSync;
let deps: ReviewFormDeps;

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  data.set("csrf_token", "token");
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const submit = (meetingId: string, fields: Record<string, string>) =>
  inLocale("fr", () => handleReviewForm(deps, "A", meetingId, form(fields)));

beforeEach(async () => {
  db = freshDb();
  const clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  const ids = new SequentialIds("id");
  const meetings = new SqliteMeetingRepository(db, ids, clock);
  deps = {
    review: {
      reviews: new SqliteReviewRepository(db, ids),
      folders: new SqliteFolderRepository(db),
      meetings,
      textCipher: cipher,
      clock,
    },
    capture: { meetings, clock },
  };
  owner(db, "A");
  folder(db, "A", "folder-A", { name: "Board" });
  await seedReviewMeeting(db, "A", "m1");
});

describe("review notices in French", () => {
  it.each([
    ["section_saved", "Section enregistrée."],
    ["decision_removed", "Décision retirée du brouillon."],
    ["action_done", "Action marquée comme terminée."],
    ["published", "Publiée. Cette note n’est plus un brouillon."],
    ["speaker_assigned", "Lignes attribuées à l’intervenant."],
  ])("%s", (code, text) => {
    expect(inLocale("fr", () => reviewNoticeText(code))).toBe(text);
  });

  it("names the folder the note is in, and never prints the code from the URL", () => {
    expect(inLocale("fr", () => reviewNoticeText("moved", "Équipe <b>"))).toBe(
      "Déplacée vers Équipe <b>.",
    );
    expect(inLocale("fr", () => reviewNoticeText("move_unchanged", "Board"))).toBe(
      "Déjà dans Board.",
    );
    expect(inLocale("fr", () => reviewNoticeText("moved"))).toBe("Déplacée.");
    expect(inLocale("fr", () => reviewNoticeText("<script>"))).toBeNull();
  });
});

describe("review form problems in French", () => {
  it("answers a rejected edit with a French summary and French field errors", async () => {
    const result = await submit("m1", { intent: "edit_section", id: "m1-sec-0", body: "  " });
    expect(result).toMatchObject({
      kind: "problem",
      status: 422,
      message: "Rien n’a été enregistré. Corrigez le problème signalé et réessayez.",
      errors: [{ field: "body", message: "Écrivez quelque chose." }],
    });
  });

  it("asks for confirmation before publishing, in French", async () => {
    const result = await submit("m1", { intent: "publish", folder: "folder-A" });
    expect(result).toMatchObject({
      kind: "problem",
      errors: [{ field: "confirm", message: "Cochez la case pour confirmer la publication." }],
    });
  });

  it("refuses a folder that is not the owner's, in French", async () => {
    const result = await submit("m1", { intent: "publish", folder: "nope", confirm: "on" });
    expect(result).toMatchObject({
      kind: "problem",
      errors: [{ field: "folder", message: "Choisissez l’un de vos dossiers." }],
    });
  });

  it("tells a conflict in French", async () => {
    await submit("m1", { intent: "publish", folder: "folder-A", confirm: "on" });
    const result = await submit("m1", { intent: "edit_section", id: "m1-sec-0", body: "x" });
    expect(result).toMatchObject({
      kind: "problem",
      status: 409,
      message: expect.stringContaining("Cette note n’est pas un brouillon modifiable") as string,
    });
  });
});
