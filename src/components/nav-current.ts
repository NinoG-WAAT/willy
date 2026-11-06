import { t } from "../i18n/translate";

/** The shell's navigation, in order. The Inbox is `/`; All notes is `/notes` (UX 2b, #72). */
const NAV_HREFS = [
  "/",
  "/notes",
  "/search",
  "/folders",
  "/settings/templates",
  "/settings",
] as const;
type NavHref = (typeof NAV_HREFS)[number];

function navLabel(href: NavHref): string {
  switch (href) {
    case "/":
      return t("Inbox");
    case "/notes":
      return t("All notes");
    case "/search":
      return t("Search");
    case "/folders":
      return t("Folders");
    case "/settings/templates":
      return t("Templates");
    case "/settings":
      return t("Settings");
  }
}

/** The links with their words for the request's language: call it per request, never at load. */
export function navLinks(): readonly { href: NavHref; label: string }[] {
  return NAV_HREFS.map((href) => ({ href, label: navLabel(href) }));
}

const within = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * The navigation link whose section the page belongs to (the longest matching prefix wins, so
 * /settings/templates/new is under Templates, not Settings). Meeting pages live under Meetings.
 * Null on pages outside the navigation, so nothing is marked as current.
 */
export function currentNavHref(pathname: string): string | null {
  if (pathname === "/meetings" || pathname.startsWith("/meetings/")) return "/";
  let best: string | null = null;
  for (const href of NAV_HREFS) {
    if (href === "/") continue;
    if (within(pathname, href) && (best === null || href.length > best.length)) best = href;
  }
  return pathname === "/" ? "/" : best;
}

export interface ShellFolderState {
  id: string;
  /**
   * "page" when this folder's own page is open; "true" for a sub-page of it (its delete
   * confirmation) or a note filed in it: the folder is where you are, but it is not the page.
   */
  current: "page" | "true";
}

/**
 * Which folder of the sidebar is active. The path decides first (/folders/:id and below); a page
 * that knows its note's folder (a published note's review) can pass it. Null when none is known.
 */
export function shellFolderState(
  pathname: string,
  noteFolderId?: string | null,
): ShellFolderState | null {
  const match = /^\/folders\/([^/]+)(\/.*)?$/.exec(pathname);
  if (match?.[1]) {
    const onPage = match[2] === undefined || match[2] === "/";
    return { id: match[1], current: onPage ? "page" : "true" };
  }
  return noteFolderId ? { id: noteFolderId, current: "true" } : null;
}
