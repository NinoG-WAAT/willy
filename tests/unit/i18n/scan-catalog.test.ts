import { describe, expect, it } from "vitest";
import {
  checkCatalog,
  clientReachableFiles,
  scanSources,
  type CatalogInputs,
  type SourceFile,
} from "../../support/i18n-scan";

/** The scanner is what makes the catalog test trustworthy, so it is tested on its own first. */

const IMPORT = 'import { t, tn, msg } from "../i18n/translate";\n';

async function sources(files: SourceFile[]) {
  return scanSources(files);
}

describe("scanSources: what counts as a translatable string", () => {
  it("extracts t, tn (both forms) and msg literals with their file and line", async () => {
    const scan = await sources([
      {
        path: "src/app/a.ts",
        text:
          IMPORT +
          'export const a = () => t("Sign in");\n' +
          'export const b = (n: number) => tn("{n} note", "{n} notes", n);\n' +
          'export const c = msg("Draft");\n',
      },
    ]);
    expect(scan.dynamic).toEqual([]);
    expect(scan.occurrences).toEqual([
      { file: "src/app/a.ts", line: 2, call: "t", source: "Sign in" },
      { file: "src/app/a.ts", line: 3, call: "tn", source: "{n} note" },
      { file: "src/app/a.ts", line: 3, call: "tn", source: "{n} notes" },
      { file: "src/app/a.ts", line: 4, call: "msg", source: "Draft" },
    ]);
  });

  it("follows import aliases and namespace imports, and resolves the path relative to the file", async () => {
    const scan = await sources([
      {
        path: "src/domain/x/a.ts",
        text: 'import { t as tr } from "../../i18n/translate";\nexport const a = tr("Aliased");\n',
      },
      {
        path: "src/app/b.ts",
        text: 'import * as i18n from "../i18n/translate";\nexport const b = i18n.t("Namespaced");\n',
      },
      {
        path: "src/scripts/c.ts",
        text: 'import { t } from "./i18n";\nexport const c = t("From a script");\n',
      },
    ]);
    expect(scan.occurrences.map((o) => o.source).sort()).toEqual([
      "Aliased",
      "From a script",
      "Namespaced",
    ]);
  });

  it("ignores a t that is not the translation function (a loop variable, another import)", async () => {
    const scan = await sources([
      {
        path: "src/app/a.ts",
        text:
          'import { t as other } from "./elsewhere";\n' +
          'export const a = [1].map((t) => t("x")); export const b = other("y");\n',
      },
    ]);
    expect(scan.occurrences).toEqual([]);
    expect(scan.dynamic).toEqual([]);
  });

  it("accepts joined literals (a long sentence split over lines) and plain template literals", async () => {
    const scan = await sources([
      {
        path: "src/app/a.ts",
        text: IMPORT + 't("One " + "sentence"); t(`Plain template`);\n',
      },
    ]);
    expect(scan.occurrences.map((o) => o.source)).toEqual(["One sentence", "Plain template"]);
    expect(scan.dynamic).toEqual([]);
  });

  it("reports calls whose first argument cannot be read statically", async () => {
    const scan = await sources([
      {
        path: "src/app/a.ts",
        text:
          IMPORT +
          "declare const label: string; declare const x: string;\n" +
          "t(label);\n" +
          "t(`Hello ${x}`);\n" +
          'tn("{n} a", label, 2);\n' +
          "msg(label);\n",
      },
    ]);
    expect(scan.dynamic.map((d) => `${String(d.line)}:${d.call}`)).toEqual([
      "3:t",
      "4:t",
      "5:tn",
      "6:msg",
    ]);
  });

  it("reads Astro files: frontmatter and template expressions", async () => {
    const scan = await sources([
      {
        path: "src/pages/p.astro",
        text:
          '---\nimport { t, tn } from "../i18n/translate";\nconst title = t("Page title");\n---\n' +
          '<h1>{title}</h1>\n<p class="x">{t("In the template")}</p>\n' +
          '<ul>{[1].map((n) => <li>{tn("{n} row", "{n} rows", n)}</li>)}</ul>\n',
      },
    ]);
    expect(scan.occurrences.map((o) => o.source).sort()).toEqual([
      "In the template",
      "Page title",
      "{n} row",
      "{n} rows",
    ]);
    const line = scan.occurrences.find((o) => o.source === "In the template")?.line;
    expect(line).toBe(6);
  });

  it("flags a sentence built from translated pieces (concatenation or template spans)", async () => {
    const scan = await sources([
      {
        path: "src/app/a.ts",
        text:
          IMPORT +
          "declare const who: string;\n" +
          't("Hello") + " " + who;\n' +
          '`${t("Hello")} ${who}`;\n' +
          'const fine = t("Hello {who}", { who });\n',
      },
    ]);
    expect(scan.concatenations.map((c) => c.line)).toEqual([3, 4]);
  });
});

describe("clientReachableFiles", () => {
  it("is every file a client script can import, directly or through other modules", () => {
    const files: SourceFile[] = [
      { path: "src/scripts/live.ts", text: 'import { pad } from "../domain/capture/pad";\n' },
      {
        path: "src/domain/capture/pad.ts",
        text: 'import { z } from "./z";\nexport const pad = z;\n',
      },
      { path: "src/domain/capture/z.ts", text: "export const z = 1;\n" },
      { path: "src/app/server-only.ts", text: "export const s = 1;\n" },
    ];
    expect(clientReachableFiles(files).sort()).toEqual([
      "src/domain/capture/pad.ts",
      "src/domain/capture/z.ts",
      "src/scripts/live.ts",
    ]);
  });
});

const CLEAN: CatalogInputs = {
  scan: {
    occurrences: [
      { file: "src/app/a.ts", line: 1, call: "t", source: "Sign in" },
      { file: "src/app/a.ts", line: 2, call: "t", source: "Hello {name}" },
      { file: "src/app/a.ts", line: 3, call: "tn", source: "{n} note" },
      { file: "src/app/a.ts", line: 3, call: "tn", source: "{n} notes" },
      { file: "src/scripts/live.ts", line: 4, call: "t", source: "Saved" },
    ],
    dynamic: [],
    concatenations: [],
  },
  catalog: {
    "Sign in": "Se connecter",
    "Hello {name}": "Bonjour {name}",
    "{n} note": "{n} note",
    "{n} notes": "{n} notes",
    Saved: "Enregistré",
  },
  sameInFrench: { "{n} note": "same word", "{n} notes": "same word" },
  clientCatalog: { Saved: "Enregistré" },
  clientFiles: ["src/scripts/live.ts"],
  allowedDynamic: {},
  allowedConcatenation: {},
};

const broken = (patch: Partial<CatalogInputs>): CatalogInputs => ({ ...CLEAN, ...patch });

describe("checkCatalog", () => {
  it("accepts a complete, consistent catalog", () => {
    expect(checkCatalog(CLEAN)).toEqual([]);
  });

  it("fails on a source string without a French entry, naming where it is used", () => {
    const catalog = Object.fromEntries(
      Object.entries(CLEAN.catalog).filter(([source]) => source !== "Sign in"),
    );
    const problems = checkCatalog(broken({ catalog }));
    expect(problems).toEqual([
      expect.stringMatching(/^missing-translation.*src\/app\/a\.ts:1.*Sign in/),
    ]);
  });

  it("fails on a French entry that no source uses", () => {
    const problems = checkCatalog(broken({ catalog: { ...CLEAN.catalog, Orphan: "Orpheline" } }));
    expect(problems).toEqual([expect.stringMatching(/^unused-entry.*Orphan/)]);
  });

  it("fails when the {params} of source and translation differ (either direction)", () => {
    expect(
      checkCatalog(broken({ catalog: { ...CLEAN.catalog, "Hello {name}": "Bonjour" } })),
    ).toEqual([expect.stringMatching(/^param-mismatch.*Hello \{name\}/)]);
    expect(
      checkCatalog(broken({ catalog: { ...CLEAN.catalog, "Hello {name}": "Bonjour {nom}" } })),
    ).toEqual([expect.stringMatching(/^param-mismatch/)]);
  });

  it("fails on a translation identical to its source unless the allowlist gives a reason", () => {
    const catalog = { ...CLEAN.catalog, "Sign in": "Sign in" };
    expect(checkCatalog(broken({ catalog }))).toEqual([
      expect.stringMatching(/^identical.*Sign in/),
    ]);
    expect(
      checkCatalog(broken({ catalog, sameInFrench: { ...CLEAN.sameInFrench, "Sign in": "x" } })),
    ).toEqual([]);
    expect(
      checkCatalog(broken({ catalog, sameInFrench: { ...CLEAN.sameInFrench, "Sign in": "  " } })),
    ).toEqual([expect.stringMatching(/^identical.*Sign in/)]);
  });

  it("does not demand an allowlist entry for strings with nothing to translate", () => {
    const scan = {
      ...CLEAN.scan,
      occurrences: [
        ...CLEAN.scan.occurrences,
        { file: "src/app/a.ts", line: 9, call: "t" as const, source: "{n}%" },
      ],
    };
    expect(checkCatalog(broken({ scan, catalog: { ...CLEAN.catalog, "{n}%": "{n}%" } }))).toEqual(
      [],
    );
  });

  it("fails on a stale allowlist entry (the string is translated differently or not used)", () => {
    const problems = checkCatalog(
      broken({ sameInFrench: { ...CLEAN.sameInFrench, "Sign in": "was identical once" } }),
    );
    expect(problems).toEqual([expect.stringMatching(/^stale-allowlist.*Sign in/)]);
  });

  it("fails on an empty translation", () => {
    expect(checkCatalog(broken({ catalog: { ...CLEAN.catalog, "Sign in": "  " } }))).toEqual([
      expect.stringMatching(/^empty.*Sign in/),
    ]);
  });

  it("fails on a non-literal call unless its file is allowlisted with a reason", () => {
    const scan = { ...CLEAN.scan, dynamic: [{ file: "src/app/labels.ts", line: 7, call: "t" }] };
    expect(checkCatalog(broken({ scan }))).toEqual([
      expect.stringMatching(/^non-literal.*src\/app\/labels\.ts:7/),
    ]);
    expect(
      checkCatalog(
        broken({ scan, allowedDynamic: { "src/app/labels.ts": "labels marked with msg()" } }),
      ),
    ).toEqual([]);
    expect(
      checkCatalog(
        broken({ scan: CLEAN.scan, allowedDynamic: { "src/app/labels.ts": "no longer needed" } }),
      ),
    ).toEqual([expect.stringMatching(/^stale-allowlist.*src\/app\/labels\.ts/)]);
  });

  it("fails on a sentence built from pieces unless the file is allowlisted", () => {
    const scan = { ...CLEAN.scan, concatenations: [{ file: "src/app/c.ts", line: 3 }] };
    expect(checkCatalog(broken({ scan }))).toEqual([
      expect.stringMatching(/^concatenation.*src\/app\/c\.ts:3/),
    ]);
    expect(
      checkCatalog(broken({ scan, allowedConcatenation: { "src/app/c.ts": "separator only" } })),
    ).toEqual([]);
  });

  it("fails on markup in a source or a translation: translations are text, never HTML", () => {
    const withMarkup = {
      ...CLEAN.scan,
      occurrences: [
        ...CLEAN.scan.occurrences,
        { file: "src/app/a.ts", line: 9, call: "t" as const, source: "Click <b>here</b>" },
      ],
    };
    expect(
      checkCatalog(
        broken({
          scan: withMarkup,
          catalog: { ...CLEAN.catalog, "Click <b>here</b>": "Cliquez <b>ici</b>" },
        }),
      ).map((p) => p.split(" ")[0]),
    ).toEqual(["markup:", "markup:"]);
    expect(
      checkCatalog(broken({ catalog: { ...CLEAN.catalog, "Sign in": "Se <i>connecter</i>" } })),
    ).toEqual([expect.stringMatching(/^markup.*Sign in/)]);
    // A comparison in prose is not markup.
    const prose = {
      ...CLEAN.scan,
      occurrences: [
        ...CLEAN.scan.occurrences,
        { file: "src/app/a.ts", line: 9, call: "t" as const, source: "Under 5 < 10 items" },
      ],
    };
    expect(
      checkCatalog(
        broken({
          scan: prose,
          catalog: { ...CLEAN.catalog, "Under 5 < 10 items": "Moins de 5 < 10 éléments" },
        }),
      ),
    ).toEqual([]);
  });

  it("fails on a source that starts or ends with whitespace (a sign of a sentence built from pieces)", () => {
    const scan = {
      ...CLEAN.scan,
      occurrences: [
        ...CLEAN.scan.occurrences,
        { file: "src/app/a.ts", line: 9, call: "t" as const, source: "Hello " },
      ],
    };
    expect(
      checkCatalog(broken({ scan, catalog: { ...CLEAN.catalog, "Hello ": "Bonjour " } })),
    ).toEqual([expect.stringMatching(/^edge-whitespace.*src\/app\/a\.ts:9/)]);
  });

  it("fails when a string a client script can reach is not in the client catalog", () => {
    expect(checkCatalog(broken({ clientCatalog: {} }))).toEqual([
      expect.stringMatching(/^client-catalog-missing.*src\/scripts\/live\.ts:4.*Saved/),
    ]);
  });

  it("fails when the client catalog carries a string no client script uses (dead weight in every bundle)", () => {
    const problems = checkCatalog(
      broken({ clientCatalog: { ...CLEAN.clientCatalog, "Sign in": "Se connecter" } }),
    );
    expect(problems).toEqual([expect.stringMatching(/^client-catalog-unused.*Sign in/)]);
  });
});
