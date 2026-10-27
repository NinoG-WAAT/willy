import { rmSync } from "node:fs";
import { afterAll } from "vitest";
import { createTempDataDir } from "./temp-data-dir";

const dir = createTempDataDir();
process.env["WILLY_DATA_DIR"] = dir;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
