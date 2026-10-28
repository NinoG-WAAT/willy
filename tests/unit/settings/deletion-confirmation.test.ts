import { describe, expect, it } from "vitest";
import {
  DELETION_CONFIRMATION_WORD,
  isDeletionConfirmed,
} from "../../../src/domain/settings/deletion-confirmation";

describe("isDeletionConfirmed", () => {
  it("asks for the word DELETE", () => {
    expect(DELETION_CONFIRMATION_WORD).toBe("DELETE");
  });

  it("accepts exactly the word, ignoring surrounding whitespace", () => {
    expect(isDeletionConfirmed("DELETE")).toBe(true);
    expect(isDeletionConfirmed("  DELETE \n")).toBe(true);
  });

  it.each([
    "",
    "   ",
    "delete",
    "Delete",
    "DELET",
    "DELETE IT",
    "DELETE DELETE",
    "yes",
    // Lookalikes: Cyrillic E, fullwidth letters, zero-width space inside.
    "DELETЕ",
    "ＤＥＬＥＴＥ",
    "DEL​ETE",
  ])("rejects %j", (typed) => {
    expect(isDeletionConfirmed(typed)).toBe(false);
  });

  it("rejects anything that is not text", () => {
    expect(isDeletionConfirmed(undefined)).toBe(false);
    expect(isDeletionConfirmed(null)).toBe(false);
    expect(isDeletionConfirmed(["DELETE"])).toBe(false);
  });
});
