import { fr } from "../i18n/fr/scripts";
import { parseLocale, registerCatalog, setLocaleResolver } from "../i18n/translate";

/**
 * Client-side translation. Importing this module (every entry script in this folder does, first)
 * registers the small client catalog and tells the shared core to read the locale from
 * `<html lang>`, which the server set for this request. Domain modules that scripts import call
 * the same `t()`, so they translate here too.
 *
 * Only `src/i18n/fr/scripts.ts` is bundled, never the whole catalog: see docs/I18N.md.
 */
registerCatalog("fr", fr);
setLocaleResolver(() => parseLocale(document.documentElement.lang) ?? undefined);

export {
  currentLocale,
  formatNumber,
  intlLocale,
  msg,
  t,
  tn,
  type Locale,
} from "../i18n/translate";
