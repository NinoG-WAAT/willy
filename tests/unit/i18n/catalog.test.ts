import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { clientFr, fr, sameInFrench } from "../../../src/i18n/fr";
import {
  checkCatalog,
  clientReachableFiles,
  scanSources,
  type Scan,
  type SourceFile,
} from "../../support/i18n-scan";
import { allowedConcatenation, allowedDynamic } from "./allowlists";

/**
 * The safety net of docs/I18N.md: every t()/tn()/msg() literal in src has a French entry, and the
 * catalog has nothing the code does not use. It reads the source with the TypeScript compiler API
 * (and Astro's compiler for .astro files), so it needs no build and runs in about a second.
 */

const ROOT = process.cwd();

function loadSources(): SourceFile[] {
  const dir = join(ROOT, "src");
  return (
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((name) => /\.(ts|astro)$/.test(name) && !name.endsWith(".d.ts"))
      .map((name) => ({
        path: join("src", name).split(sep).join("/"),
        text: readFileSync(join(dir, name), "utf8"),
      }))
      // The catalogs hold French text, not calls; skipping them keeps the scan fast.
      .filter((file) => !file.path.startsWith("src/i18n/fr/"))
      .sort((a, b) => a.path.localeCompare(b.path))
  );
}

const files = loadSources();
let scan: Scan | undefined;

describe("French catalog", () => {
  it("scans the real source: the scanner finds .ts and .astro strings (it is not passing on nothing)", async () => {
    scan = await scanSources(files);
    const found = new Set(scan.occurrences.map((o) => `${o.file} ${o.source}`));
    expect(found).toContain("src/pages/sign-in.astro Password");
    expect(found).toContain("src/app/identity/handle-sign-in.ts Enter your email and password.");
    expect(files.some((f) => f.path.endsWith(".astro"))).toBe(true);
  });

  it("every client entry script starts by importing the i18n bootstrap (else t() in the browser answers in English)", () => {
    const entries = files.filter((f) => /^src\/scripts\/[^/]+\.ts$/.test(f.path));
    expect(entries.length).toBeGreaterThan(3);
    const withoutBootstrap = entries
      .filter((f) => f.path !== "src/scripts/i18n.ts")
      .filter((f) => !/^import "\.\/i18n";$/m.test(f.text))
      .map((f) => f.path);
    expect(withoutBootstrap).toEqual([]);
  });

  it("has no problem: every string translated, nothing unused, params and rules respected", async () => {
    scan ??= await scanSources(files);
    const problems = checkCatalog({
      scan,
      catalog: fr,
      sameInFrench,
      clientCatalog: clientFr,
      clientFiles: clientReachableFiles(files),
      allowedDynamic,
      allowedConcatenation,
    });
    expect(problems).toEqual([]);
  });
});
