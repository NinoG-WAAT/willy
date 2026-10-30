/** The shell's navigation, in order. Home becomes the Inbox in a later increment (UX 2b). */
export const NAV_LINKS: readonly { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/search", label: "Search" },
  { href: "/folders", label: "Folders" },
  { href: "/settings/templates", label: "Templates" },
  { href: "/settings", label: "Settings" },
];

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
  for (const { href } of NAV_LINKS) {
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
