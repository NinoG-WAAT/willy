import { describe, expect, it } from "vitest";
import { pageTitle } from "../../src/components/page-title";

describe("pageTitle", () => {
  it("appends the product name to a page title", () => {
    expect(pageTitle("Meetings")).toBe("Meetings - Willycrumbs");
  });

  it("returns only the product name when no title is given", () => {
    expect(pageTitle()).toBe("Willycrumbs");
    expect(pageTitle("")).toBe("Willycrumbs");
    expect(pageTitle("   ")).toBe("Willycrumbs");
  });

  it("trims and collapses whitespace", () => {
    expect(pageTitle("  Live   note \n")).toBe("Live note - Willycrumbs");
  });

  it("does not double the product name", () => {
    expect(pageTitle("Willycrumbs")).toBe("Willycrumbs");
  });
});
