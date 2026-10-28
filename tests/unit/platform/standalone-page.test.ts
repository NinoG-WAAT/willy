import { describe, expect, it } from "vitest";
import { forbiddenResponse } from "../../../src/app/identity/route-access";
import { rateLimitedResponse } from "../../../src/app/ops/rate-limits";
import { standalonePage } from "../../../src/app/platform/standalone-page";

// These documents are built outside Astro (no layout), so the basics a layout would give are
// asserted here: language, viewport for phones, a title, one landmark and one h1.
function expectUsableDocument(html: string): void {
  expect(html).toMatch(/^<!doctype html>/i);
  expect(html).toContain('<html lang="en">');
  expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  expect(html).toMatch(/<title>[^<]+ - Willycrumbs<\/title>/);
  expect(html.match(/<main>/g)).toHaveLength(1);
  expect(html.match(/<h1>/g)).toHaveLength(1);
  expect(html).toContain('<a href="/">Back to your meetings</a>');
}

describe("standalonePage", () => {
  it("renders a complete accessible document", () => {
    expectUsableDocument(standalonePage("Request refused", "<p>Nope.</p>"));
  });

  it("uses the title as the heading and keeps the body as given", () => {
    const html = standalonePage("Request refused", "<p>Nope.</p>");
    expect(html).toContain("<h1>Request refused</h1>");
    expect(html).toContain("<p>Nope.</p>");
  });
});

describe("failure responses built outside the layout", () => {
  it("the 403 page is a usable document", async () => {
    const res = forbiddenResponse(new URL("http://localhost/sign-out"));
    expect(res.status).toBe(403);
    expectUsableDocument(await res.text());
  });

  it("the 429 page is a usable document", async () => {
    const res = rateLimitedResponse(30, "/search");
    expect(res.status).toBe(429);
    expectUsableDocument(await res.text());
  });
});
