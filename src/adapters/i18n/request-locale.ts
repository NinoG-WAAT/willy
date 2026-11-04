import { AsyncLocalStorage } from "node:async_hooks";
import { fr } from "../../i18n/fr";
import {
  configureI18n,
  registerCatalog,
  setLocaleResolver,
  type Locale,
} from "../../i18n/translate";
import type { Logger } from "../../ports/logger";

/**
 * The locale of the request being served, held in an AsyncLocalStorage so every `t()` call below
 * the middleware (pages, components, use cases, domain functions) can ask for it without a locale
 * being passed down. It holds one word of non-secret state per request and nothing between them.
 */
const requests = new AsyncLocalStorage<Locale>();

/** Runs `fn` (and everything it awaits or schedules) with `locale` as the request locale. */
export function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return requests.run(locale, fn);
}

/** The locale of the running request; undefined outside one (start-up, a background job). */
export function currentRequestLocale(): Locale | undefined {
  return requests.getStore();
}

export interface InstallI18nOptions {
  /** Used outside a request (jobs, start-up) and by signed-out pages; read lazily. */
  defaultLocale: () => Locale;
  strict: boolean;
  /** Where "missing translation" lines go; read lazily so start-up needs no logger yet. */
  logger: () => Logger | undefined;
}

/**
 * Wires the translation core to this process: the French catalog, the request-locale resolver,
 * strict mode and missing-string logging. Called from `src/composition.ts`; idempotent, so
 * calling it again replaces the options.
 */
export function installI18n(options: InstallI18nOptions): void {
  registerCatalog("fr", fr);
  setLocaleResolver(() => requests.getStore() ?? options.defaultLocale());
  configureI18n({
    strict: options.strict,
    onMissing: ({ locale, source }) => {
      // The key is a literal from the code, never owner text: safe to log, and it is what the
      // developer needs to find the gap.
      options.logger()?.warn("i18n.missing_translation", { locale, source: source.slice(0, 120) });
    },
  });
}
