import { describe, expect, it } from "vitest";
import { parseModelOutput } from "../../../src/adapters/llm/summary-schema";

const good = {
  sections: [{ heading: "Summary", body: "We met.", source_from: 0, source_to: 2 }],
  decisions: [{ text: "Ship it", source_from: 1, source_to: 1 }],
  action_items: [
    { text: "Send deck", assignee_id: "a1", due_date: "2026-11-05", source_from: 1, source_to: 1 },
  ],
};

describe("parseModelOutput (model output is untrusted)", () => {
  it("maps the wire format to the domain shape", () => {
    expect(parseModelOutput(good)).toEqual({
      ok: true,
      value: {
        sections: [{ heading: "Summary", body: "We met.", sourceFrom: 0, sourceTo: 2 }],
        decisions: [{ text: "Ship it", sourceFrom: 1, sourceTo: 1 }],
        actionItems: [
          {
            text: "Send deck",
            assigneeId: "a1",
            dueDate: "2026-11-05",
            sourceFrom: 1,
            sourceTo: 1,
          },
        ],
      },
    });
  });

  it("treats a missing or null assignee and due date as 'none'", () => {
    const result = parseModelOutput({
      ...good,
      action_items: [{ text: "x", source_from: 0, source_to: 0 }],
    });
    expect(result.ok && result.value.actionItems[0]).toMatchObject({
      assigneeId: null,
      dueDate: null,
    });
  });

  it.each([
    ["not an object", "text"],
    ["null", null],
    ["missing sections", { decisions: [], action_items: [] }],
    ["sections not an array", { ...good, sections: "x" }],
    ["unknown top-level field", { ...good, tool_calls: [{ name: "send_email" }] }],
    [
      "unknown item field",
      { ...good, decisions: [{ text: "d", source_from: 0, source_to: 0, url: "http://evil" }] },
    ],
    [
      "non-string body",
      { ...good, sections: [{ heading: "h", body: 5, source_from: 0, source_to: 0 }] },
    ],
    ["negative source", { ...good, decisions: [{ text: "d", source_from: -1, source_to: 0 }] }],
    ["fractional source", { ...good, decisions: [{ text: "d", source_from: 0.5, source_to: 1 }] }],
    ["missing source", { ...good, decisions: [{ text: "d" }] }],
    [
      "huge payload array",
      { ...good, decisions: Array.from({ length: 5000 }, () => good.decisions[0]) },
    ],
  ])("rejects %s", (_name, value) => {
    expect(parseModelOutput(value)).toEqual({ ok: false, error: { kind: "malformed" } });
  });
});
