import { describe, expect, it } from "vitest";
import {
  providerError,
  providerErrorFromStatus,
} from "../../../src/domain/platform/provider-error";

describe("providerError", () => {
  it("marks rejected as non-retryable and everything else as retryable", () => {
    expect(providerError("rejected", "bad").retryable).toBe(false);
    expect(providerError("timeout", "slow").retryable).toBe(true);
    expect(providerError("rate_limited", "slow down").retryable).toBe(true);
    expect(providerError("unavailable", "down").retryable).toBe(true);
  });
});

describe("providerErrorFromStatus", () => {
  it.each([
    [400, "rejected"],
    [401, "rejected"],
    [403, "rejected"],
    [404, "rejected"],
    [408, "timeout"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [502, "unavailable"],
    [503, "unavailable"],
    [301, "rejected"],
  ] as const)("maps HTTP %i to %s", (status, kind) => {
    const error = providerErrorFromStatus(status);
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
  });

  it("never echoes a response body or headers", () => {
    expect(providerErrorFromStatus(401).message).toBe("provider responded with HTTP 401");
  });
});
