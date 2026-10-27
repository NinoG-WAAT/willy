import js from "@eslint/js";
import astro from "eslint-plugin-astro";
import tseslint from "typescript-eslint";
import { domainPurity } from "./eslint.domain-purity.js";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      ".astro/",
      "node_modules/",
      "playwright-report/",
      "test-results/",
      "coverage/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((c) => ({ ...c, files: ["**/*.ts"] })),
  ...astro.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    // `expect(() => insertRow(...)).toThrow()` is the idiom for constraint tests.
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-confusing-void-expression": "off" },
  },
  ...domainPurity,
);
