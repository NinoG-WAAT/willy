import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function messagesFor(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => `${m.ruleId}: ${m.message}`);
}

describe("domain purity lint rules (CLAUDE.md section 4)", () => {
  it.each([
    ['import { x } from "../../app/meetings/y";', "app"],
    ['import { x } from "../../adapters/d1/y";', "adapters"],
    ['import { x } from "../../pages/index";', "pages"],
    ['import { x } from "astro";', "astro"],
    ['import { x } from "@cloudflare/workers-types";', "cloudflare"],
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
    expect(messages.filter((m) => m.startsWith("no-restricted"))).toEqual([]);
  });
});
