import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Translated text is plain text: it is rendered as a text node, never parsed as HTML (OWASP A03,
 * docs/I18N.md). The one way to break that is a sink that parses a string as markup, so none may
 * appear in src. An exception needs a path and a reason here, and a reviewer's eye.
 */

const SINKS = [
  /\bset:html\b/,
  /\.innerHTML\b/,
  /\.outerHTML\b/,
  /\binsertAdjacentHTML\b/,
  /\bdocument\.write\b/,
  /\bdangerouslySetInnerHTML\b/,
];

/** Path -> why that file may parse markup (and why the string it parses is never translated or owner text). */
const ALLOWED: Readonly<Record<string, string>> = {};

function sourceFiles(): { path: string; text: string }[] {
  const dir = join(process.cwd(), "src");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(ts|astro)$/.test(name))
    .map((name) => ({
      path: join("src", name).split(sep).join("/"),
      text: readFileSync(join(dir, name), "utf8"),
    }));
}

describe("no HTML sinks in src", () => {
  it("nothing parses a string as markup (set:html, innerHTML, outerHTML, insertAdjacentHTML, document.write)", () => {
    const found = sourceFiles()
      .filter((file) => !Object.hasOwn(ALLOWED, file.path))
      .flatMap((file) =>
        file.text
          .split("\n")
          .map((line, index) => ({ file: file.path, line: index + 1, text: line }))
          .filter(({ text }) => SINKS.some((sink) => sink.test(text))),
      )
      .map(({ file, line, text }) => `${file}:${String(line)} ${text.trim()}`);
    expect(found).toEqual([]);
  });

  it("the sink patterns match what they are meant to catch", () => {
    for (const code of [
      "<div set:html={x} />",
      "el.innerHTML = x",
      "el.outerHTML = x",
      'el.insertAdjacentHTML("beforeend", x)',
      "document.write(x)",
      "<div dangerouslySetInnerHTML={{ __html: x }} />",
    ]) {
      expect(
        SINKS.some((sink) => sink.test(code)),
        code,
      ).toBe(true);
    }
    expect(SINKS.some((sink) => sink.test("el.textContent = x"))).toBe(false);
  });
});
