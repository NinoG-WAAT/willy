/** Narrowing helper so tests never need non-null assertions. */
export function defined<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}
