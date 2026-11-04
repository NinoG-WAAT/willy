/**
 * French for client scripts (`src/scripts/**` and every module they import). This is the ONLY
 * catalog the browser downloads, so it holds only strings a script can show: the catalog test
 * fails if a client-reachable string is missing here, or if an entry here is not used by one.
 */
export const fr: Record<string, string> = {
  // src/components/format-instant.ts (job times in the progress script)
  "unknown time": "heure inconnue",
};

export const sameInFrench: Record<string, string> = {};
