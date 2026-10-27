import { describe, expect, it } from "vitest";
import { createFakeSummarizer } from "../../../src/adapters/llm/fake-summarizer";
import { INJECTION, sampleInput, summarizerContract } from "./summarizer.contract";

summarizerContract("fake", () => {
  const fake = createFakeSummarizer();
  return {
    summarizer: fake,
    modelReturns: (output) => {
      fake.script.respondOnce(output);
    },
    failNext: (kind) => {
      fake.script.failOnce(kind);
    },
  };
});

describe("fake summarizer specifics", () => {
  it("is deterministic and grounded when nothing is scripted", async () => {
    const fake = createFakeSummarizer();
    const a = await fake.summarize(sampleInput());
    const b = await fake.summarize(sampleInput());
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.sections).toHaveLength(1);
    expect(a.value.sections[0]).toMatchObject({
      heading: "Summary",
      sourceFrom: 0,
      sourceTo: 10000,
    });
    expect(a.value.decisions).toEqual([
      { text: "We agreed to ship the beta in November.", sourceFrom: 1, sourceTo: 1 },
    ]);
    expect(a.value.actionItems).toEqual([
      {
        text: "I will send the pricing deck by Friday.",
        assigneeId: null,
        dueDate: null,
        sourceFrom: 10000,
        sourceTo: 10000,
      },
    ]);
  });

  it("follows the template sections", async () => {
    const fake = createFakeSummarizer();
    const result = await fake.summarize(
      sampleInput({
        template: {
          sections: [
            { heading: "Summary", prompt: "p" },
            { heading: "Risks", prompt: "p" },
          ],
        },
      }),
    );
    expect(result.ok && result.value.sections.map((s) => s.heading)).toEqual(["Summary", "Risks"]);
  });

  it("regenerates only the requested section", async () => {
    const fake = createFakeSummarizer();
    const result = await fake.summarize(sampleInput({ only: { heading: "Risks", prompt: "p" } }));
    expect(result.ok && result.value.sections.map((s) => s.heading)).toEqual(["Risks"]);
    expect(result.ok && result.value.decisions).toEqual([]);
  });

  it("assigns an action item to an attendee only when that attendee is named in the text", async () => {
    const fake = createFakeSummarizer();
    const result = await fake.summarize(
      sampleInput({
        segments: [{ position: 0, speaker: "Speaker 1", text: "Grace will send the contract." }],
      }),
    );
    expect(result.ok && result.value.actionItems[0]?.assigneeId).toBe("a2");
  });

  it("is not steered by instructions inside the transcript", async () => {
    const fake = createFakeSummarizer();
    const plain = await fake.summarize(
      sampleInput({ segments: [{ position: 0, speaker: "S", text: "Let's review the roadmap." }] }),
    );
    const hostile = await fake.summarize(
      sampleInput({ segments: [{ position: 0, speaker: "S", text: INJECTION }] }),
    );
    expect(hostile.ok && hostile.value.decisions).toEqual([]);
    expect(hostile.ok && hostile.value.actionItems).toEqual([]);
    expect(JSON.stringify(hostile)).not.toContain("evil@attacker.test");
    expect(plain.ok && plain.value.sections.length).toBe(
      hostile.ok ? hostile.value.sections.length : -1,
    );
  });

  it("records call shapes, never transcript text", async () => {
    const fake = createFakeSummarizer();
    await fake.summarize(sampleInput());
    expect(fake.calls).toEqual([{ segments: 3, attendees: 2, only: null }]);
  });
});
