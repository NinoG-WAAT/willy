import { describe, expect, it } from "vitest";
import { securityHeaders } from "../../src/app/ops/security-headers";

describe("securityHeaders", () => {
  const headers = securityHeaders();

  it("blocks MIME sniffing and framing", () => {
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("limits the microphone to the app origin only", () => {
    expect(headers["Permissions-Policy"]).toContain("microphone=(self)");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("sets a strict referrer policy", () => {
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("has a CSP without inline script or eval", () => {
    const csp = headers["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });
});
