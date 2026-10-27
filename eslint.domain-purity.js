// CLAUDE.md section 4: domain/ is pure and imports only inward. Kept in its own module so the
// rule set is tested in isolation (tests/integration/domain-import-rules.test.ts).
/** @type {import("eslint").Linter.Config[]} */
export const domainPurity = [
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "astro", message: "domain/ must not depend on Astro." }],
          patterns: [
            {
              group: ["**/app/**", "**/adapters/**", "**/pages/**", "**/components/**"],
              message: "domain/ may not import from app/, adapters/, pages/ or components/.",
            },
            {
              group: ["@cloudflare/*", "astro:*", "astro/*"],
              message: "domain/ must not depend on the runtime.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Inject a Clock instead." },
        { object: "Math", property: "random", message: "Inject an IdGenerator instead." },
      ],
    },
  },
];
