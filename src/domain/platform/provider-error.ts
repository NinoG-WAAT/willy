export type ProviderErrorKind = "timeout" | "rejected" | "rate_limited" | "unavailable";

/**
 * What every adapter reports for a failed external call. The message is written by us and must
 * never contain tokens, response bodies or personal data (CLAUDE.md A09).
 */
export interface ProviderError {
  kind: ProviderErrorKind;
  retryable: boolean;
  message: string;
  status?: number;
}

export function providerError(
  kind: ProviderErrorKind,
  message: string,
  status?: number,
): ProviderError {
  const base = { kind, retryable: kind !== "rejected", message };
  return status === undefined ? base : { ...base, status };
}

/** Maps an HTTP status to a normalized error. Redirects are rejections: we never follow them. */
export function providerErrorFromStatus(status: number): ProviderError {
  const message = `provider responded with HTTP ${String(status)}`;
  if (status === 408) return providerError("timeout", message, status);
  if (status === 429) return providerError("rate_limited", message, status);
  if (status >= 500) return providerError("unavailable", message, status);
  return providerError("rejected", message, status);
}
