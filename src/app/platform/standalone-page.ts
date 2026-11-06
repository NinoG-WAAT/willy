import { currentLocale, t } from "../../i18n/translate";

/** Text for an HTML text node or a double-quoted attribute: translated text is plain text. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** One paragraph of plain text, escaped. */
export const paragraph = (text: string): string => `<p>${escapeHtml(text)}</p>`;

/**
 * A minimal complete HTML document for responses built outside Astro (403, 429, 500), where the
 * layout cannot run. It still carries what assistive technology and phones need: language,
 * viewport, a title, one landmark, one h1, and a way back. The CSP forbids inline style, so the
 * page relies on the browser defaults, which are readable at any size.
 *
 * The language is the request's (`<html lang>` and every word): callers run inside the locale the
 * middleware resolved (see `src/middleware.ts`), so `t()` here answers for that request.
 *
 * `title` is plain text, already translated by the caller; it is escaped here. `bodyHtml` must
 * already be safe HTML (callers escape the translated text they put in it with `escapeHtml` and
 * pass nothing else but ids the server generated itself).
 */
export function standalonePage(title: string, bodyHtml: string): string {
  const heading = escapeHtml(title);
  const back = escapeHtml(t("Back to your meetings"));
  return (
    `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${heading} - Willycrumbs</title></head>` +
    `<body><main><h1>${heading}</h1>${bodyHtml}<p><a href="/">${back}</a></p></main></body></html>`
  );
}
