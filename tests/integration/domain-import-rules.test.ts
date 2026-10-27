import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { domainPurity } from "../../eslint.domain-purity.js";

// Only the purity rules, without type-aware linting, so virtual files can be linted.
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: true,
  overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
    ...domainPurity,
  ],
});

async function messagesFor(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => `${String(m.ruleId)}: ${m.message}`);
}

describe("domain purity lint rules (CLAUDE.md section 4)", () => {
  it.each([
    'import { x } from "../../app/meetings/y";',
    'import { x } from "../../adapters/d1/y";',
    'import { x } from "../../pages/index";',
    'import { x } from "astro";',
    'import { x } from "astro:middleware";',
    'import { x } from "@cloudflare/workers-types";',
  ])("forbids %s inside src/domain", async (code) => {
    const messages = await messagesFor(code, "src/domain/meetings/sample.ts");
    expect(messages.some((m) => m.startsWith("no-restricted-imports"))).toBe(true);
  });

  it("forbids Date.now and Math.random inside src/domain (inject Clock/IdGenerator)", async () => {
    const messages = await messagesFor(
      "export const a = () => Date.now(); export const b = () => Math.random();",
      "src/domain/meetings/sample.ts",
    );
    expect(messages.filter((m) => m.startsWith("no-restricted-properties"))).toHaveLength(2);
  });

  it("allows the same code outside src/domain", async () => {
    const messages = await messagesFor(
      'import { x } from "astro"; export const a = () => Date.now(); void x;',
      "src/app/meetings/sample.ts",
    );
    expect(messages.filter((m) => m.startsWith("no-restricted"))).toEqual([]);
  });

  it("allows pure domain-to-domain imports", async () => {
    const messages = await messagesFor(
      'import { y } from "../platform/ids"; export const a = y;',
      "src/domain/meetings/sample.ts",
    );
    expect(messages).toEqual([]);
  });
});
