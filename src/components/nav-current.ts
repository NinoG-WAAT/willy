export const NAV_LINKS: readonly { href: string; label: string }[] = [
  { href: "/", label: "Meetings" },
  { href: "/search", label: "Search" },
  { href: "/settings/templates", label: "Templates" },
  { href: "/settings/folders", label: "Folders" },
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
