import { z } from "zod";
import type { RawSummary } from "../../domain/notes/summary";
import { err, ok, type Result } from "../../domain/platform/result";

// Hard caps only guard memory; the domain applies the real limits (and rejects, never truncates).
const MAX_ITEMS = 200;
const MAX_STRING = 100_000;
const text = z.string().max(MAX_STRING);
const position = z.number().int().min(0);

/** Wire format of the model's answer. Unknown fields anywhere are an error (strict). */
const ModelOutputSchema = z.strictObject({
  sections: z
    .array(
      z.strictObject({
        heading: text,
        body: text,
        source_from: position,
        source_to: position,
      }),
    )
    .max(MAX_ITEMS),
  decisions: z
    .array(z.strictObject({ text, source_from: position, source_to: position }))
    .max(MAX_ITEMS),
  action_items: z
    .array(
      z.strictObject({
        text,
        assignee_id: z.string().max(200).nullish(),
        due_date: z.string().max(40).nullish(),
        source_from: position,
        source_to: position,
      }),
    )
    .max(MAX_ITEMS),
});

/** Validates model output (untrusted) and maps it to the domain shape. Never throws. */
export function parseModelOutput(value: unknown): Result<RawSummary, { kind: "malformed" }> {
  const parsed = ModelOutputSchema.safeParse(value);
  if (!parsed.success) return err({ kind: "malformed" });
  const out = parsed.data;
  return ok({
    sections: out.sections.map((s) => ({
      heading: s.heading,
      body: s.body,
      sourceFrom: s.source_from,
      sourceTo: s.source_to,
    })),
    decisions: out.decisions.map((d) => ({
      text: d.text,
      sourceFrom: d.source_from,
      sourceTo: d.source_to,
    })),
    actionItems: out.action_items.map((a) => ({
      text: a.text,
      assigneeId: a.assignee_id ?? null,
      dueDate: a.due_date ?? null,
      sourceFrom: a.source_from,
      sourceTo: a.source_to,
    })),
  });
}

/** JSON Schema of the same wire format, handed to the provider as the tool input schema. */
export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sections", "decisions", "action_items"],
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "body", "source_from", "source_to"],
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          source_from: { type: "integer", minimum: 0 },
          source_to: { type: "integer", minimum: 0 },
        },
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "source_from", "source_to"],
        properties: {
          text: { type: "string" },
          source_from: { type: "integer", minimum: 0 },
          source_to: { type: "integer", minimum: 0 },
        },
      },
    },
    action_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "assignee_id", "due_date", "source_from", "source_to"],
        properties: {
          text: { type: "string" },
          assignee_id: { type: ["string", "null"] },
          due_date: { type: ["string", "null"], description: "YYYY-MM-DD, only if stated" },
          source_from: { type: "integer", minimum: 0 },
          source_to: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;
