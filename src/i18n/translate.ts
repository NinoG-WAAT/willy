/**
 * The translation core (see docs/I18N.md). Gettext style: the English text IS the key, English
 * returns it unchanged, and other locales look it up in a catalog.
 *
 * Pure on purpose: no I/O, no Node or browser API, no Astro. The domain, the use cases, the pages
 * and the client scripts all import this one module. The locale of the current request is not
 * stored here: a resolver function registered at start-up answers "which locale now?" on every
 * call (the server adapter backs it with an AsyncLocalStorage, the browser with `<html lang>`),
 * so nothing here can leak one request's locale into another.
 */

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
/** Locales that need a catalog; English is the source text itself. */
export type TranslatedLocale = Exclude<Locale, "en">;

export const DEFAULT_LOCALE: Locale = "en";

export type Params = Readonly<Record<string, string | number>>;

/** Exact (after trim and lower-casing) locale code, or null. Never guesses from "fr-FR". */
export function parseLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return LOCALES.find((locale) => locale === code) ?? null;
}

/** A string was asked for in a non-English locale and the catalog has no entry (strict mode). */
export class MissingTranslationError extends Error {
  constructor(
    readonly locale: Locale,
    readonly source: string,
  ) {
    super(`Missing ${locale} translation for ${JSON.stringify(source)}`);
    this.name = "MissingTranslationError";
  }
}

export interface MissingTranslation {
  locale: Locale;
  source: string;
}

interface State {
  resolver: () => Locale | undefined;
  catalogs: Map<Locale, ReadonlyMap<string, string>>;
  strict: boolean;
  onMissing: (missing: MissingTranslation) => void;
  reported: Set<string>;
}

const state: State = {
  resolver: () => undefined,
  catalogs: new Map(),
  strict: false,
  onMissing: () => undefined,
  reported: new Set(),
};

/** Registers who answers "which locale is this call for?". Called once at start-up. */
export function setLocaleResolver(resolver: () => Locale | undefined): void {
  state.resolver = resolver;
}

/** The locale of the current request (or page); English when nobody says otherwise. */
export function currentLocale(): Locale {
  return state.resolver() ?? DEFAULT_LOCALE;
}

/**
 * Installs the catalog of one locale, replacing an earlier one. The entries are copied into a
 * Map so a source string such as "constructor" can never find an Object.prototype member.
 */
export function registerCatalog(
  locale: TranslatedLocale,
  entries: Readonly<Record<string, string>>,
): void {
  if ((locale as Locale) === "en") {
    throw new Error("English has no catalog: the source string is the English text");
  }
  state.catalogs.set(locale, new Map(Object.entries(entries)));
  state.reported.clear();
}

export interface I18nOptions {
  /** Throw MissingTranslationError instead of falling back to English (non-English locales only). */
  strict?: boolean;
  /** Called once per missing (locale, source), in non-strict mode, before falling back. */
  onMissing?: (missing: MissingTranslation) => void;
}

export function configureI18n(options: I18nOptions): void {
  if (options.strict !== undefined) state.strict = options.strict;
  if (options.onMissing !== undefined) state.onMissing = options.onMissing;
}

function lookup(locale: Locale, source: string): string {
  if (locale === "en") return source;
  const found = state.catalogs.get(locale)?.get(source);
  if (found !== undefined) return found;
  if (state.strict) throw new MissingTranslationError(locale, source);
  const key = `${locale}\u0000${source}`;
  if (!state.reported.has(key)) {
    state.reported.add(key);
    state.onMissing({ locale, source });
  }
  return source;
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The `{names}` a template uses, in order. For tooling (the catalog test); screens never need it. */
export function placeholderNames(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

/** One pass over the template: a value is inserted literally and never re-scanned. */
function interpolate(template: string, params: Params | undefined): string {
  if (params === undefined) return template;
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    if (!Object.hasOwn(params, name)) return placeholder;
    return String(params[name]);
  });
}

/**
 * Translates `source` for the current locale and fills its `{name}` placeholders from `params`.
 * A placeholder without a param stays visible (`{name}`); it never throws. The result is plain
 * text: render it as a text node, never as HTML.
 */
export function t(source: string, params?: Params): string {
  return interpolate(lookup(currentLocale(), source), params);
}

/** English: one is exactly 1. French: 0 and 1 are singular (also 1.5, as in "1,5 heure"). */
function isSingular(locale: Locale, n: number): boolean {
  return locale === "fr" ? Math.abs(n) < 2 : n === 1;
}

/**
 * Plural: pass both English forms, each containing `{n}`. `{n}` is filled automatically with `n`
 * formatted for the locale, and cannot be overridden through `params`. Both forms are ordinary
 * catalog keys, translated independently.
 */
export function tn(one: string, many: string, n: number, params?: Params): string {
  const locale = currentLocale();
  const source = isSingular(locale, n) ? one : many;
  return interpolate(lookup(locale, source), { ...params, n: formatNumber(n, locale) });
}

/**
 * Marks a string for extraction without translating it now: returns `source` unchanged. Use it
 * where a string must exist before a locale does (a table of labels at module level), then pass
 * the stored value to `t()` when it is shown. See docs/I18N.md.
 */
export function msg(source: string): string {
  return source;
}

const INTL_TAGS: Readonly<Record<Locale, string>> = { en: "en-GB", fr: "fr-FR" };

/** The `Intl` language tag the date and number formatters use for a locale. */
export function intlLocale(locale: Locale = currentLocale()): string {
  return INTL_TAGS[locale];
}

export function formatNumber(value: number, locale: Locale = currentLocale()): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}
