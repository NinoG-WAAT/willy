import { msg, t } from "../../i18n/translate";

// English sources, marked with msg() so the catalog test knows each needs a French entry; the
// text is translated per request in settingsNotice() (never at load time, which would freeze the
// language of whichever request imported this module first).
const NOTICES: Readonly<Record<string, string>> = {
  language_saved: msg("Language saved."),
  retention_saved: msg("Retention settings saved."),
  deletion_requested: msg(
    "Deletion started. The meeting is already hidden everywhere. Its progress is shown below.",
  ),
  deletion_repeated: msg("That deletion was already requested. Its progress is shown below."),
  deletion_retried: msg("Deletion queued again. Its progress is shown below."),
  deletion_nothing_to_retry: msg("Nothing to retry: that deletion is not stopped."),
  vocabulary_added: msg("Words added. They are used for the next transcription."),
  vocabulary_unchanged: msg("Those words were already in your vocabulary. Nothing changed."),
  vocabulary_removed: msg("Word removed."),
};

/**
 * Success messages travel as a fixed code in the query string after a redirect. Only known codes
 * map to text, so nothing from the URL is ever reflected into the page.
 */
export function settingsNotice(code: string | null): string | null {
  if (code === null || !Object.hasOwn(NOTICES, code)) return null;
  const source = NOTICES[code];
  return source === undefined ? null : t(source);
}
