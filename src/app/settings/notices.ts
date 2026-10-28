const NOTICES: Readonly<Record<string, string>> = {
  retention_saved: "Retention settings saved.",
  deletion_requested:
    "Deletion started. The meeting is already hidden everywhere. Its progress is shown below.",
  deletion_repeated: "That deletion was already requested. Its progress is shown below.",
  deletion_retried: "Deletion queued again. Its progress is shown below.",
  deletion_nothing_to_retry: "Nothing to retry: that deletion is not stopped.",
};

/**
 * Success messages travel as a fixed code in the query string after a redirect. Only known codes
 * map to text, so nothing from the URL is ever reflected into the page.
 */
export function settingsNotice(code: string | null): string | null {
  return code !== null && Object.hasOwn(NOTICES, code) ? (NOTICES[code] ?? null) : null;
}
