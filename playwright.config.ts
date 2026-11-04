import { defineConfig, devices } from "@playwright/test";
import { createTempDataDir } from "./tests/support/temp-data-dir";

const port = Number(process.env["E2E_PORT"] ?? 4321);
const baseURL = `http://localhost:${String(port)}`;
// A second server with WILLY_DEFAULT_LOCALE=fr: signed-out pages (sign-in) can only be French
// through the server default, and the default is a process setting. Only tests/e2e/i18n-fr.spec.ts
// uses it; every other spec runs on the English server above.
const frPort = Number(process.env["E2E_FR_PORT"] ?? port + 1);
const frBaseURL = `http://localhost:${String(frPort)}`;

// "localhost" on purpose: without security.allowedDomains Astro derives its own origin as
// localhost:<port> (it does not trust the Host header), and its Origin check must see a match.
// Fresh data dir per run: the server under test never touches developer data. The config is
// loaded again in every worker, so the first load publishes the directory through the environment.
const dataDir = process.env["E2E_DATA_DIR"] ?? createTempDataDir();
process.env["E2E_DATA_DIR"] = dataDir;
const frDataDir = process.env["E2E_FR_DATA_DIR"] ?? createTempDataDir();
process.env["E2E_FR_DATA_DIR"] = frDataDir;
process.env["E2E_FR_BASE_URL"] = frBaseURL;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Small viewport required by CLAUDE.md (390x844) with touch emulation.
    {
      name: "phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: "npm run build && npm run db:seed && node ./dist/server/entry.mjs",
      url: `${baseURL}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: serverEnv(port, dataDir, "en"),
    },
    {
      // Servers start one after the other, so the build above has finished and `dist` exists.
      command: "npm run db:seed && node ./dist/server/entry.mjs",
      url: `${frBaseURL}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: serverEnv(frPort, frDataDir, "fr"),
    },
  ],
});

function serverEnv(
  serverPort: number,
  serverDataDir: string,
  defaultLocale: "en" | "fr",
): Record<string, string> {
  return {
    HOST: "127.0.0.1",
    PORT: String(serverPort),
    WILLY_DATA_DIR: serverDataDir,
    // Every test signs in from 127.0.0.1; the per-email limit is what the rate-limit test exercises.
    SIGN_IN_CLIENT_LIMIT: "1000",
    // Tests drive background jobs explicitly instead of racing a timer.
    WILLY_JOB_RUNNER: "off",
    WILLY_JOBS_ENDPOINT: "1",
    // Ben's demo calendar simulates an outage so the import failure state can be tested.
    FAKE_CALENDAR_DOWN_OWNERS: "owner-ben",
    // Short audio chunks so the capture tests do not wait ten seconds per chunk.
    WILLY_CAPTURE_SEGMENT_MS: "1500",
    // Set explicitly: a developer shell that exports WILLY_DEFAULT_LOCALE must not change the tests.
    WILLY_DEFAULT_LOCALE: defaultLocale,
    // A t() call with no French entry fails the request loudly instead of showing English.
    WILLY_I18N_STRICT: "1",
  };
}
