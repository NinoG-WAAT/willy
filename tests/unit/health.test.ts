import { describe, expect, it } from "vitest";
import { getHealth } from "../../src/app/ops/health";

describe("getHealth", () => {
  it("reports status only, never data or configuration", () => {
    expect(getHealth()).toEqual({ status: "ok" });
  });
});
