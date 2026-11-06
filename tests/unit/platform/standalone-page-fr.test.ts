import { describe, expect, it } from "vitest";
import { createCaptureLogger } from "../../../src/adapters/logging/json-logger";
import { forbiddenResponse } from "../../../src/app/identity/route-access";
import { bodyTooLargeResponse } from "../../../src/app/ops/body-limits";
import { rateLimitedResponse } from "../../../src/app/ops/rate-limits";
import { observeRequest } from "../../../src/app/ops/request-observer";
import { escapeHtml, standalonePage } from "../../../src/app/platform/standalone-page";
import { t } from "../../../src/i18n/translate";
import { inLocale } from "../../support/locale";

// The documents built outside Astro (403, 411/413, 429, 500) follow the language of the request
// (#121): <html lang> and every word. A request in English is byte-for-byte what it was.

const NBSP = " ";

describe("standalonePage in French", () => {
  it("says it is French and translates the way back", () => {
    const html = inLocale("fr", () => standalonePage(t("Request refused"), "<p>x</p>"));
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("<title>Demande refusée - Willycrumbs</title>");
    expect(html).toContain("<h1>Demande refusée</h1>");
    expect(html).toContain('<a href="/">Retour à vos réunions</a>');
  });

  it("stays English, with lang en, outside a French request", () => {
    const html = standalonePage("Request refused", "<p>x</p>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<a href="/">Back to your meetings</a>');
  });

  it("escapes the title: text is never markup", () => {
    const html = standalonePage('<img src=x onerror="a()">', "");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;a()&quot;&gt;");
    expect(escapeHtml('a&b<c>"d')).toBe("a&amp;b&lt;c&gt;&quot;d");
  });
});

describe("failure responses in French", () => {
  it("the 403 page", async () => {
    const res = inLocale("fr", () => forbiddenResponse(new URL("http://localhost/sign-out")));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("<h1>Demande refusée</h1>");
    expect(html).toContain(
      "<p>Votre demande n’a pas pu être vérifiée. Revenez en arrière, rechargez la page et réessayez.</p>",
    );
  });

  it("the 403 for an API path is still a code, in any language", async () => {
    const res = inLocale("fr", () => forbiddenResponse(new URL("http://localhost/api/x")));
    expect(await res.json()).toEqual({ error: "csrf_failed" });
  });

  it("the 429 page, with the French plural and the Retry-After header unchanged", async () => {
    const many = inLocale("fr", () => rateLimitedResponse(30, "/search"));
    expect(many.status).toBe(429);
    expect(many.headers.get("Retry-After")).toBe("30");
    const html = await many.text();
    expect(html).toContain("<h1>Trop de requêtes</h1>");
    expect(html).toContain("<p>Veuillez patienter 30 secondes, puis réessayez.</p>");
    const one = inLocale("fr", () => rateLimitedResponse(1, "/search"));
    expect(await one.text()).toContain("<p>Veuillez patienter 1 seconde, puis réessayez.</p>");
  });

  it("the 413 and 411 pages", async () => {
    const tooLarge = inLocale("fr", () => bodyTooLargeResponse(413));
    expect(tooLarge.status).toBe(413);
    const large = await tooLarge.text();
    expect(large).toContain("<h1>Fichier trop volumineux</h1>");
    expect(large).toContain(
      '<a href="/meetings/import/ics">Retour à l’import du fichier de calendrier</a>',
    );
    const unsized = inLocale("fr", () => bodyTooLargeResponse(411));
    expect(await unsized.text()).toContain("<h1>Envoi non accepté</h1>");
  });

  it("the 500 page is written in the language the request was served in, and quotes only the id", async () => {
    const logger = createCaptureLogger();
    const deps = { logger, now: () => 0, newId: () => "req-0000000a" };
    const res = await observeRequest(
      deps,
      {
        method: "GET",
        pathname: "/search",
        inboundRequestId: null,
        ownerId: () => undefined,
        // What the middleware passes: re-enter the language the request was resolved in.
        inRequestLocale: (fn) => inLocale("fr", fn),
      },
      () => {
        throw new Error("boom: secret transcript text");
      },
    );
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("<h1>Une erreur est survenue</h1>");
    expect(html).toContain("<p>Vos notes sont en sécurité. Réessayez dans un instant.</p>");
    expect(html).toContain(
      `Si le problème persiste, indiquez cette référence${NBSP}: <code>req-0000000a</code>`,
    );
    expect(html).not.toMatch(/boom|secret/);
  });
});
