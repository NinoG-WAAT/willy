import { defineConfig, devices } from "@playwright/test";
import { createTempDataDir } from "./tests/support/temp-data-dir";

const port = Number(process.env["E2E_PORT"] ?? 4321);
const baseURL = `http://127.0.0.1:${port}`;

// Fresh data dir per run: the server under test never touches developer data.
const dataDir = createTempDataDir();

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
  webServer: {
    command: "npm run build && node ./dist/server/entry.mjs",
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      HOST: "127.0.0.1",
      PORT: String(port),
      WILLY_DATA_DIR: dataDir,
    },
  },
});
