import { describe, expect, it } from "vitest";
import {
  classifyRoute,
  forbiddenResponse,
  unauthenticatedResponse,
} from "../../../src/app/identity/route-access";

describe("classifyRoute", () => {
  it.each([
    "/healthz",
    "/sign-in",
    "/signed-out",
    "/session-expired",
    "/_astro/x.css",
    "/favicon.svg",
  ])("treats %s as public", (p) => {
    expect(classifyRoute(p)).toBe("public");
  });

  it("treats webhook endpoints as signature-authenticated (no session, no CSRF)", () => {
    expect(classifyRoute("/webhooks/calendar")).toBe("signature");
  });

  it.each([
    "/",
    "/meetings/123",
    "/api/meetings/1/chunks",
    "/search",
    "/settings",
    "/diagnostics",
    "/oauth/calendar/callback",
    "/sign-in/../meetings/1",
    "/healthz/extra",
    "/signed-out-evil",
  ])("requires an owner session for %s", (p) => {
    expect(classifyRoute(p)).toBe("owner");
  });
});

describe("unauthenticatedResponse", () => {
  const url = new URL("https://app.example/meetings/42?tab=notes");

  it("redirects pages to sign-in, remembering where the owner was going", () => {
    const r = unauthenticatedResponse("anonymous", "GET", url);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/sign-in?next=%2Fmeetings%2F42%3Ftab%3Dnotes");
  });

  it("redirects expired sessions to the expired page", () => {
    const r = unauthenticatedResponse("expired", "GET", url);
    expect(r.headers.get("location")).toBe("/session-expired?next=%2Fmeetings%2F42%3Ftab%3Dnotes");
  });

  it("does not remember a next path for state-changing requests", () => {
    const r = unauthenticatedResponse("anonymous", "POST", url);
    expect(r.headers.get("location")).toBe("/sign-in");
  });

  it("answers API paths with JSON 401 and no redirect", async () => {
    const r = unauthenticatedResponse(
      "expired",
      "GET",
      new URL("https://app.example/api/meetings/1/status"),
    );
    expect(r.status).toBe(401);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(await r.json()).toEqual({ error: "session_expired" });
  });

  it("is never cacheable", () => {
    expect(unauthenticatedResponse("anonymous", "GET", url).headers.get("cache-control")).toBe(
      "no-store",
    );
  });
});

describe("forbiddenResponse", () => {
  it("is a 403 JSON for API paths and a plain page otherwise", async () => {
    const api = forbiddenResponse(new URL("https://app.example/api/x"));
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({ error: "csrf_failed" });
    const page = forbiddenResponse(new URL("https://app.example/meetings/1/publish"));
    expect(page.status).toBe(403);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("could not be verified");
  });
});
