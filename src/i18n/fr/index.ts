import { mergeCatalogs } from "../merge-catalogs";
import * as auth from "./auth";
import * as capture from "./capture";
import * as scripts from "./scripts";
import * as search from "./search";
import * as settings from "./settings";
import * as shell from "./shell";
import * as summaries from "./summaries";

/**
 * One module per area, so parallel work never edits the same file. To add an area: create
 * `src/i18n/fr/<area>.ts` exporting `fr` (and `sameInFrench` for words that are identical in
 * French) and list it here. See docs/I18N.md.
 */
const AREAS: Record<string, AreaModule> = {
  shell,
  auth,
  settings,
  search,
  scripts,
  summaries,
  capture,
};

interface AreaModule {
  fr: Record<string, string>;
  sameInFrench: Record<string, string>;
}

const pick = (key: keyof AreaModule): Record<string, Record<string, string>> =>
  Object.fromEntries(Object.entries(AREAS).map(([name, module]) => [name, module[key]]));

/** The whole French catalog, for the server. */
export const fr = mergeCatalogs(pick("fr"));

/** English source -> reason it is the same word in French (read by the catalog test). */
export const sameInFrench: Record<string, string> = Object.fromEntries(
  Object.values(pick("sameInFrench")).flatMap((reasons) => Object.entries(reasons)),
);

/** The strings client scripts can show: the only catalog sent to browsers. */
export const clientFr = scripts.fr;
