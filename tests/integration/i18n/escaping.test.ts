import { getViteConfig } from "astro/config";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as Translate from "../../../src/i18n/translate";

/**
 * OWASP A03: translations are text nodes only. This renders a real Astro component through
 * Astro's own compiler and checks that markup in a translation, or in a value inserted into one,
 * comes out escaped. (Screens never use set:html; tests/unit/i18n/no-html-sinks.test.ts forbids it.)
 */

let server: ViteDevServer;
// The component is loaded through Vite, which makes its own copy of the module: configure that one.
let i18n: typeof Translate;
let render: (name: string) => Promise<string>;

beforeAll(async () => {
  const config = await getViteConfig({})({ command: "serve", mode: "test" });
  server = await createServer({ ...config, server: { middlewareMode: true }, logLevel: "silent" });
  i18n = (await server.ssrLoadModule("/src/i18n/translate.ts")) as typeof Translate;
  const module = (await server.ssrLoadModule("/tests/fixtures/i18n/Greeting.astro")) as {
    default: Parameters<AstroContainer["renderToString"]>[0];
  };
  const container = await AstroContainer.create();
  render = (name) => container.renderToString(module.default, { props: { name } });
}, 60_000);

afterAll(async () => {
  await server.close();
});

describe("markup in translated text", () => {
  it("a value inserted into a sentence is escaped, in English", async () => {
    i18n.setLocaleResolver(() => "en");
    const html = await render("<img src=x onerror=alert(1)>");
    expect(html).toContain("Hello &lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });

  it("a value inserted into a sentence is escaped in French, and so is markup in a catalog entry", async () => {
    i18n.registerCatalog("fr", {
      "Hello {name}": "Bonjour {name}",
      "Click <b>here</b>": "Cliquez <b>ici</b>",
    });
    i18n.setLocaleResolver(() => "fr");
    const html = await render('"><script>alert(1)</script>');
    expect(html).toContain("Bonjour &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Cliquez &lt;b&gt;ici&lt;/b&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
  });
});
