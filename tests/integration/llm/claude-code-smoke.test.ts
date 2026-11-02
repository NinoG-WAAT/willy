import { describe, expect, it } from "vitest";
import { createSummarizer } from "../../../src/adapters/llm";
import { readLlmConfig } from "../../../src/adapters/llm/config";

/**
 * Manual smoke test against the REAL Claude Code CLI, logged in on this machine. Skipped unless
 * you opt in, so CI never needs the CLI or a login. The text below is synthetic: nothing from a
 * real meeting is sent. It counts as a small request against your seat's usage.
 *
 *   LLM_PROVIDER=claude-code npx vitest run tests/integration/llm/claude-code-smoke
 */
describe.skipIf(process.env["LLM_PROVIDER"] !== "claude-code")(
  "real Claude Code CLI smoke test (manual)",
  () => {
    it("turns a short synthetic transcript into a grounded draft", async () => {
      const config = readLlmConfig(process.env);
      if (!config.ok) throw new Error(config.error);
      const summarizer = createSummarizer(config.value, fetch);
      const result = await summarizer.summarize({
        segments: [
          { position: 0, speaker: "Speaker 1", text: "Bonjour, on fait le point sur la bêta." },
          { position: 1, speaker: "Speaker 2", text: "On a décidé de livrer la bêta en novembre." },
          {
            position: 2,
            speaker: "Speaker 1",
            text: "Je m'occupe d'envoyer le dossier prix vendredi.",
          },
        ],
        agenda: "Point bêta",
        attendees: [{ id: "a1", name: "Ada" }],
        template: {
          sections: [
            { heading: "Summary", prompt: "Summarize what was discussed." },
            { heading: "Risks", prompt: "List risks that were raised. Empty if none." },
          ],
        },
        only: null,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      expect(result.value.sections.length).toBeGreaterThan(0);
      expect(result.value.decisions.length).toBeGreaterThan(0);
    }, 240_000);
  },
);
