import { describe, expect, it } from "vitest";
import { mergeCatalogs } from "../../../src/i18n/merge-catalogs";

describe("mergeCatalogs", () => {
  it("merges area modules into one catalog", () => {
    expect(mergeCatalogs({ auth: { A: "a" }, shell: { B: "b" } })).toEqual({ A: "a", B: "b" });
  });

  it("tolerates the same string translated the same way in two areas (a shared word such as Cancel)", () => {
    expect(mergeCatalogs({ auth: { Cancel: "Annuler" }, notes: { Cancel: "Annuler" } })).toEqual({
      Cancel: "Annuler",
    });
  });

  it("refuses the same string translated differently, naming both areas", () => {
    expect(() => mergeCatalogs({ auth: { Open: "Ouvrir" }, notes: { Open: "Ouverte" } })).toThrow(
      /"Open".*auth.*notes/,
    );
  });

  it("is not fooled by keys named like Object.prototype members", () => {
    const merged = mergeCatalogs({ a: { constructor: "constructeur" } });
    expect(merged["constructor"]).toBe("constructeur");
    expect(Object.hasOwn(merged, "toString")).toBe(false);
    expect("toString" in merged).toBe(false);
    expect(Object.getPrototypeOf(merged)).toBe(null);
  });
});
