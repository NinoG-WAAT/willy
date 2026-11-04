import { err, ok, type Result } from "../../domain/platform/result";
import { LOCALES, parseLocale, type Locale } from "../../i18n/translate";

export interface I18nConfig {
  /** The locale of signed-out pages and of owners who have not chosen one. */
  defaultLocale: Locale;
  /** A missing French string throws instead of falling back to English (e2e crawls, CI). */
  strict: boolean;
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * Reads WILLY_DEFAULT_LOCALE (default `en`) and WILLY_I18N_STRICT (`1` or `0`, default `0`).
 * Errors name the variable, never its value.
 */
export function readI18nConfig(env: EnvLike): Result<I18nConfig, string> {
  const rawLocale = (env["WILLY_DEFAULT_LOCALE"] ?? "").trim();
  const defaultLocale = rawLocale === "" ? "en" : parseLocale(rawLocale);
  if (defaultLocale === null) {
    return err(`WILLY_DEFAULT_LOCALE must be one of: ${LOCALES.join(", ")}`);
  }
  const rawStrict = (env["WILLY_I18N_STRICT"] ?? "").trim();
  if (rawStrict !== "" && rawStrict !== "1" && rawStrict !== "0") {
    return err("WILLY_I18N_STRICT must be 1 or 0");
  }
  return ok({ defaultLocale, strict: rawStrict === "1" });
}
