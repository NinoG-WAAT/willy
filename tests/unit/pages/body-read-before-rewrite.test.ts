import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Astro re-reads the incoming request when a page calls rewrite("/404"). A body that was
// already consumed makes that rewrite throw, so the owner sees the 500 page instead of the 404
// (#52). Pages that can rewrite must therefore read the body from a clone of the request.
//
// This is a source-level guard, not a behavioral test: the failure needs a use case to answer
// not_found after the body was read (a meeting vanishing mid-request), which cannot be produced
// deterministically through HTTP. It proves no rewriting route reads the request body directly;
// it does not prove the clone is what makes the rewrite succeed at runtime.

const PAGES = join(__dirname, "../../../src/pages");

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return /\.(astro|ts)$/.test(entry.name) ? [path] : [];
  });
}

// `request.formData()` / `Astro.request.text()` / `request.body` on the request itself, but not
// on `request.clone()` (which does not match: `.clone` sits between `request` and the reader).
const DIRECT_BODY_READ = /\brequest\s*\.\s*(formData|json|text|arrayBuffer|blob|bytes|body)\b/g;

function directBodyReads(source: string): string[] {
  return [...source.matchAll(DIRECT_BODY_READ)].map((match) => match[0]);
}

describe("directBodyReads (the guard's matcher)", () => {
  it("flags a direct read of the request body", () => {
    expect(directBodyReads("await Astro.request.formData()")).toHaveLength(1);
    expect(directBodyReads("await request.text()")).toHaveLength(1);
  });

  it("accepts a read from a clone", () => {
    expect(directBodyReads("await Astro.request.clone().formData()")).toEqual([]);
    expect(directBodyReads("await request.clone().formData()")).toEqual([]);
  });
});

describe("pages that can rewrite to the 404 page", () => {
  const rewriting = pageFiles(PAGES)
    .map((path) => ({ path: relative(PAGES, path), source: readFileSync(path, "utf8") }))
    .filter(({ source }) => /\brewrite\(/.test(source));

  it("finds the rewriting pages (the guard is not vacuous)", () => {
    expect(rewriting.length).toBeGreaterThan(5);
  });

  it.each(rewriting.map(({ path, source }) => [path, source] as const))(
    "%s reads the request body only from a clone",
    (_path, source) => {
      expect(directBodyReads(source)).toEqual([]);
    },
  );
});
