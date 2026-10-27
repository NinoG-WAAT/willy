import node from "@astrojs/node";
import { defineConfig } from "astro/config";

// Astro does not trust the Host header: behind a real domain, list it at build time
// (WILLY_ALLOWED_HOSTS=app.example.com,...) so Astro.url, the Origin check and CSRF see it.
const allowedDomains = (process.env.WILLY_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean)
  .map((hostname) => ({ hostname, protocol: "https" }));

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // No inline CSS/JS so the CSP can forbid 'unsafe-inline'.
  build: { inlineStylesheets: "never" },
  vite: { build: { assetsInlineLimit: 0 } },
  security: { allowedDomains },
  devToolbar: { enabled: false },
});
