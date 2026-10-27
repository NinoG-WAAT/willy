import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalObjectStore } from "../../../src/adapters/fs/local-object-store";
import { objectStoreContract } from "./object-store.contract";

const dirs: string[] = [];
const freshRoot = () => {
  const dir = mkdtempSync(join(tmpdir(), "willy-objects-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

objectStoreContract("local filesystem fake", () => {
  const local = createLocalObjectStore(freshRoot());
  return { store: local, failNext: (kind) => local.script.failOnce(kind) };
});

describe("local object store specifics", () => {
  it("keeps everything under its root and survives a restart", async () => {
    const root = freshRoot();
    await createLocalObjectStore(root).put(
      "owner/o1/meeting/m1/chunk-0",
      new Uint8Array([9]),
      "audio/webm",
    );
    const again = createLocalObjectStore(root);
    expect(await again.get("owner/o1/meeting/m1/chunk-0")).toEqual({
      ok: true,
      value: { bytes: new Uint8Array([9]), contentType: "audio/webm" },
    });
    expect(readdirSync(root)).toEqual(["owner"]);
  });

  it("never writes outside the root, whatever the key", async () => {
    const root = freshRoot();
    const store = createLocalObjectStore(root);
    for (const key of [
      "../escape",
      "owner/o1/../../escape",
      "/etc/passwd",
      "owner/o1/..%2f..%2fescape",
    ]) {
      await store.put(key, new Uint8Array([1]), "audio/webm");
    }
    expect(
      readdirSync(join(root, ".."), { withFileTypes: true }).some((e) => e.name === "escape"),
    ).toBe(false);
  });
});
