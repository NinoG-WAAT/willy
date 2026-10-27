const PRODUCT_NAME = "Willycrumbs";

/** Builds a useful, consistent document title: "<page> - Willycrumbs". */
export function pageTitle(title?: string): string {
  const clean = (title ?? "").replace(/\s+/g, " ").trim();
  if (clean === "" || clean === PRODUCT_NAME) return PRODUCT_NAME;
  return `${clean} - ${PRODUCT_NAME}`;
}
