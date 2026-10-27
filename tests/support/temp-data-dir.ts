import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Fresh directory for local databases and fake object storage so no test run shares state. */
export function createTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), "willy-data-"));
}
