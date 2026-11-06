import type { JobHandler } from "../../app/jobs/runner";
import { currentLocale } from "../../i18n/translate";
import type { LanguageRepository } from "../../ports/language-repository";
import { runWithLocale } from "./request-locale";

/**
 * Runs a job in the language of the owner it belongs to, so every `t()` below it (the summary
 * job's built-in headings, the language handed to the summarizer, the language hint handed to
 * speech-to-text) answers in French for a French owner, with no locale passed down.
 *
 * Outside a request the resolver answers with the server default, so an owner who has not chosen
 * (or whose choice cannot be read) is served in that default. A language is a preference: a failed
 * read never fails or delays the job, it logs one warning with the error's name and no owner data.
 */
export function withOwnerLocale(handler: JobHandler, languages: LanguageRepository): JobHandler {
  return {
    kind: handler.kind,
    run: async (job, log) => {
      const fallback = currentLocale();
      let locale = fallback;
      try {
        locale = (await languages.get(job.ownerId)) ?? fallback;
      } catch (cause) {
        log.warn("i18n.locale_unavailable", {
          errorName: cause instanceof Error ? cause.name : "unknown",
        });
      }
      return runWithLocale(locale, () => handler.run(job, log));
    },
  };
}
