/**
 * Merges the per-area French modules into one catalog. The same English string in two areas is
 * fine when both translate it the same way (a shared word such as "Cancel"); two different
 * translations of one string cannot both be right, so that throws at start-up, naming the areas.
 * The result has no prototype, so a source string like "constructor" is just a key.
 */
export function mergeCatalogs(
  areas: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Record<string, string> {
  const merged: Record<string, string> = Object.create(null) as Record<string, string>;
  const owner = new Map<string, string>();
  for (const [area, entries] of Object.entries(areas)) {
    for (const [source, translation] of Object.entries(entries)) {
      const existing = owner.get(source);
      if (existing !== undefined && merged[source] !== translation) {
        throw new Error(
          `French catalog conflict: ${JSON.stringify(source)} is translated differently in "${existing}" and "${area}"`,
        );
      }
      merged[source] = translation;
      owner.set(source, existing ?? area);
    }
  }
  return merged;
}
