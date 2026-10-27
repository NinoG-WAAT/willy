import { describe, expect, it } from "vitest";
import {
  canDeleteMeeting,
  canEditMeeting,
  canExportMeeting,
  canUseFolder,
  canUseTemplate,
  canViewMeeting,
} from "../../../src/domain/authz/predicates";

const meeting = (ownerId: string, status: string) => ({ ownerId, status });

describe("authorization predicates (single Owner role, owner id comes from the session)", () => {
  it("lets an owner view, edit, export and delete their own meeting", () => {
    const m = meeting("A", "review");
    expect(canViewMeeting("A", m)).toBe(true);
    expect(canEditMeeting("A", m)).toBe(true);
    expect(canExportMeeting("A", m)).toBe(true);
    expect(canDeleteMeeting("A", m)).toBe(true);
  });

  it("denies another owner everything, in every status", () => {
    for (const status of [
      "scheduled",
      "capturing",
      "review",
      "published",
      "archived",
      "deleting",
    ]) {
      const m = meeting("A", status);
      expect(canViewMeeting("B", m), status).toBe(false);
      expect(canEditMeeting("B", m), status).toBe(false);
      expect(canExportMeeting("B", m), status).toBe(false);
      expect(canDeleteMeeting("B", m), status).toBe(false);
    }
  });

  it("treats deleting and deleted meetings as nonexistent, even for the owner", () => {
    for (const status of ["deleting", "deleted"]) {
      const m = meeting("A", status);
      expect(canViewMeeting("A", m), status).toBe(false);
      expect(canEditMeeting("A", m), status).toBe(false);
      expect(canExportMeeting("A", m), status).toBe(false);
    }
  });

  it("lets the owner request deletion of an archived or failed meeting but not twice-finish it", () => {
    expect(canDeleteMeeting("A", meeting("A", "archived"))).toBe(true);
    expect(canDeleteMeeting("A", meeting("A", "failed"))).toBe(true);
    expect(canDeleteMeeting("A", meeting("A", "deleted"))).toBe(false);
  });

  it("denies an empty or missing owner id", () => {
    expect(canViewMeeting("", meeting("", "scheduled"))).toBe(false);
  });

  it("scopes folders and templates by owner", () => {
    expect(canUseFolder("A", { ownerId: "A" })).toBe(true);
    expect(canUseFolder("B", { ownerId: "A" })).toBe(false);
    expect(canUseTemplate("A", { ownerId: "A" })).toBe(true);
    expect(canUseTemplate("B", { ownerId: "A" })).toBe(false);
  });
});
