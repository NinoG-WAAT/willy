import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    // Every test file gets its own temp data dir (see tests/support/temp-data-dir.ts).
    setupFiles: ["tests/support/vitest-setup.ts"],
  },
});
