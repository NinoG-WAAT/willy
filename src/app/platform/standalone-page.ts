/**
 * A minimal complete HTML document for responses built outside Astro (403, 429, 500), where the
 * layout cannot run. It still carries what assistive technology and phones need: language,
 * viewport, a title, one landmark, one h1, and a way back. The CSP forbids inline style, so the
 * page relies on the browser defaults, which are readable at any size.
 *
 * `title` is a fixed string chosen by the caller; `bodyHtml` must already be safe HTML (callers
 * pass static text, plus ids that the server generated itself).
 */
export function standalonePage(title: string, bodyHtml: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${title} - Willycrumbs</title></head>` +
    `<body><main><h1>${title}</h1>${bodyHtml}<p><a href="/">Back to your meetings</a></p></main></body></html>`
  );
}
