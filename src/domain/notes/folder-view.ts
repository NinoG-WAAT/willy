/** Notes shown per page of a folder: a founder's folder is read top-down, not searched. */
export const FOLDER_PAGE_SIZE = 25;

/** A page number from the query string is untrusted: beyond this it is treated as the last page. */
const MAX_PAGE = 10_000;

/** Reads `?page=`: a positive whole number, otherwise the first page. Never throws. */
export function parsePage(raw: string | null): number {
  if (raw === null || !/^[0-9]{1,12}$/.test(raw)) return 1;
  const page = Number(raw);
  if (page < 1) return 1;
  return Math.min(page, MAX_PAGE);
}

export interface PageWindow {
  /** The page actually shown (the requested one, clamped into range). */
  page: number;
  pageCount: number;
  offset: number;
  limit: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/** Where a page starts. A page past the end shows the last page rather than an empty one. */
export function pageWindow(total: number, requestedPage: number): PageWindow {
  const pageCount = Math.max(1, Math.ceil(total / FOLDER_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  return {
    page,
    pageCount,
    offset: (page - 1) * FOLDER_PAGE_SIZE,
    limit: FOLDER_PAGE_SIZE,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
  };
}
