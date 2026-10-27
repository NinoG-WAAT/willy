import { describe, expect, it } from "vitest";
import {
  chunkObjectKey,
  isOwnedBy,
  isSafePrefix,
  isValidObjectKey,
  isValidStorageId,
  meetingPrefix,
  ownerPrefix,
} from "../../../src/domain/storage/object-key";

describe("storage ids", () => {
  it.each(["a", "owner-ada", "0f9c1e2a-1b2c-4d5e-8f90-123456789abc", "A_b-9"])(
    "accepts %j",
    (id) => {
      expect(isValidStorageId(id)).toBe(true);
    },
  );

  it.each(["", "a/b", "..", "a b", "a.b", "é", "a\u0000b", "x".repeat(65), "a\\b"])(
    "rejects %j",
    (id) => {
      expect(isValidStorageId(id)).toBe(false);
    },
  );
});

describe("object keys are per-owner and cannot escape their prefix", () => {
  it("builds chunk keys under owner/<id>/meeting/<id>/", () => {
    expect(chunkObjectKey("o1", "m1", 7)).toBe("owner/o1/meeting/m1/chunk-7");
    expect(ownerPrefix("o1")).toBe("owner/o1/");
    expect(meetingPrefix("o1", "m1")).toBe("owner/o1/meeting/m1/");
  });

  it("throws for ids that could traverse or collide (a bug, not user input)", () => {
    expect(() => chunkObjectKey("../x", "m1", 0)).toThrow();
    expect(() => chunkObjectKey("o1", "m/1", 0)).toThrow();
    expect(() => chunkObjectKey("o1", "m1", -1)).toThrow();
    expect(() => chunkObjectKey("o1", "m1", 1.5)).toThrow();
  });

  it("tells whether a key belongs to an owner, without prefix confusion", () => {
    expect(isOwnedBy("o1", "owner/o1/meeting/m1/chunk-0")).toBe(true);
    expect(isOwnedBy("o1", "owner/o10/meeting/m1/chunk-0")).toBe(false);
    expect(isOwnedBy("o1", "owner/o2/meeting/m1/chunk-0")).toBe(false);
    expect(isOwnedBy("o1", "other/o1/x")).toBe(false);
  });

  it.each(["owner/o1/meeting/m1/chunk-0", "owner/o1/x.bin"])("accepts the object key %j", (key) => {
    expect(isValidObjectKey(key)).toBe(true);
  });

  it.each([
    "",
    "/owner/o1/x",
    "owner/o1/",
    "owner//o1/x",
    "owner/o1/../o2/x",
    "owner/./x",
    "owner/o1/x\\y",
    "owner/o1/x\u0000",
    "owner/o1/x y",
    "owner/o1/file.__meta",
    "a/".repeat(20) + "x",
    "owner/o1/" + "x".repeat(600),
  ])("rejects the object key %j", (key) => {
    expect(isValidObjectKey(key)).toBe(false);
  });

  it("only allows deleting by a prefix that is at least an owner directory and ends with /", () => {
    expect(isSafePrefix("owner/o1/")).toBe(true);
    expect(isSafePrefix("owner/o1/meeting/m1/")).toBe(true);
    for (const bad of [
      "",
      "/",
      "owner/",
      "owner",
      "owner/o1",
      "owner/o1/meeting",
      "../",
      "owner/../",
    ]) {
      expect(isSafePrefix(bad), bad).toBe(false);
    }
  });
});
