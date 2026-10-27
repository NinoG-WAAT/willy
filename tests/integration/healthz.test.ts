import { describe, expect, it } from "vitest";
import { GET } from "../../src/pages/healthz";

describe("GET /healthz", () => {
  it("returns 200 with status only and is never cached", async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
