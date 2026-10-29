import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DESIGN.md is the visual reference and src/styles/tokens.css is the one place its values live
 * (issue #59). These guards keep it that way: a colour or radius typed into any other stylesheet,
 * `<style>` block or `style=""` attribute fails here, and every colour token in DESIGN.md must
 * exist in the token file with the same value.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const TOKEN_FILE = join(ROOT, "src", "styles", "tokens.css");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The style text of a source file: all of a stylesheet, only `<style>` and `style=""` elsewhere. */
function styleText(path: string, source: string): string {
  if (path.endsWith(".css")) return source;
  if (!path.endsWith(".astro")) return "";
  const blocks = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? "");
  const attributes = [...source.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1] ?? "");
  return [...blocks, ...attributes].join("\n");
}

const NAMED_COLOURS = [
  "white",
  "black",
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "pink",
  "gray",
  "grey",
  "silver",
  "maroon",
  "navy",
  "teal",
  "olive",
  "lime",
  "aqua",
  "fuchsia",
  "cyan",
  "magenta",
  "brown",
  "gold",
  "crimson",
  "tomato",
  "coral",
  "indigo",
  "violet",
];
const COLOUR_PROPERTY =
  /(?:^|[;{\s])(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|text-decoration-color|caret-color|accent-color)\s*:\s*([^;}]+)/g;

/** What is wrong with a piece of style text: colour literals and hard-coded radii. */
export function styleViolations(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/#[0-9a-f]{3,8}\b/gi)) found.push(`hex colour ${m[0]}`);
  for (const m of text.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi)) {
    found.push(`colour function ${m[0]}`);
  }
  for (const m of text.matchAll(COLOUR_PROPERTY)) {
    const value = (m[1] ?? "").replace(/var\([^)]*\)/g, "").replace(/url\([^)]*\)/g, "");
    for (const word of value.toLowerCase().split(/[^a-z-]+/)) {
      if (NAMED_COLOURS.includes(word)) found.push(`named colour ${word}`);
    }
  }
  for (const m of text.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g)) {
    const value = (m[1] ?? "").replace(/var\([^)]*\)/g, "");
    if (/(?:^|[\s/])0*[1-9]\d*(?:\.\d+)?(?:px|rem|em)\b/.test(value)) {
      found.push(`hard-coded radius ${value.trim()}`);
    }
  }
  return found;
}

describe("the style guard", () => {
  it("is not vacuous: it flags colour literals, named colours and hard-coded radii", () => {
    expect(styleViolations("a { color: #fff; }")).not.toEqual([]);
    expect(styleViolations("a { background: rgba(0, 0, 0, 0.4); }")).not.toEqual([]);
    expect(styleViolations("a { border: 1px solid white; }")).not.toEqual([]);
    expect(styleViolations("a { border-radius: 6px; }")).not.toEqual([]);
  });

  it("accepts token references and structural values", () => {
    const css =
      "a { color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-md); background: transparent; outline: 2px solid currentcolor; } b { border-radius: 50%; border-radius: 0; }";
    expect(styleViolations(css)).toEqual([]);
  });
});

describe("DESIGN.md tokens live in one file", () => {
  it("has no colour literal or hard-coded radius outside src/styles/tokens.css", () => {
    const offenders: string[] = [];
    for (const path of walk(join(ROOT, "src"))) {
      if (path === TOKEN_FILE) continue;
      const found = styleViolations(styleText(path, readFileSync(path, "utf8")));
      for (const f of found) offenders.push(`${relative(ROOT, path)}: ${f}`);
    }
    expect(offenders).toEqual([]);
  });

  it("defines every DESIGN.md colour, radius and spacing token with the same value", () => {
    const design = readFileSync(join(ROOT, "DESIGN.md"), "utf8");
    const tokens = readFileSync(TOKEN_FILE, "utf8");
    // The reference's own "CSS Custom Properties" block is the list of record.
    const wanted = [
      ...design.matchAll(/^\s*(--(?:color|spacing|radius)-[a-z0-9-]+):\s*([^;]+);/gm),
    ].map((m) => [m[1] ?? "", (m[2] ?? "").trim()] as const);
    expect(wanted.length).toBeGreaterThan(30);
    const missing = wanted.filter(([name, value]) => {
      const own = new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(tokens);
      return own?.[1]?.trim().toLowerCase() !== value.toLowerCase();
    });
    expect(missing).toEqual([]);
  });
});
