/**
 * Reads a submitted form into text values, refusing anything unexpected: unknown field names and
 * file uploads make the whole form malformed (CLAUDE.md: unknown fields rejected).
 */
export function readFormFields(
  form: FormData,
  allowed: readonly string[],
): Map<string, string[]> | null {
  const fields = new Map<string, string[]>();
  for (const [name, value] of form.entries()) {
    if (!allowed.includes(name) || typeof value !== "string") return null;
    fields.set(name, [...(fields.get(name) ?? []), value]);
  }
  return fields;
}

/** The single value of a field, or undefined when absent or repeated. */
export function single(fields: Map<string, string[]>, name: string): string | undefined {
  const values = fields.get(name);
  return values?.length === 1 ? values[0] : undefined;
}
