import {
  providerError,
  providerErrorFromStatus,
  type ProviderError,
} from "../../domain/platform/provider-error";
import { err, ok, type Result } from "../../domain/platform/result";

export interface GuardOptions {
  timeoutMs: number;
  /** Exact hostnames this adapter may talk to (CLAUDE.md A10). */
  allowedHosts: readonly string[];
}

/**
 * The only way adapters make outbound HTTP calls: https only, allowlisted host, fixed timeout
 * (covering the body read), redirects never followed, every failure normalized to a ProviderError.
 * Response bodies of failures are never read, so provider-side details cannot leak into logs.
 */
export async function guardedFetchJson(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  options: GuardOptions,
): Promise<Result<unknown, ProviderError>> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err(providerError("rejected", "invalid outbound URL"));
  }
  if (parsed.protocol !== "https:" || !options.allowedHosts.includes(parsed.hostname)) {
    return err(providerError("rejected", "outbound host not allowed"));
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, options.timeoutMs);
  });
  const timeoutError = () =>
    err(providerError("timeout", `provider call exceeded ${String(options.timeoutMs)}ms`));

  try {
    const call = (async (): Promise<Result<unknown, ProviderError>> => {
      const response = await doFetch(url, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status < 200 || response.status >= 300)
        return err(providerErrorFromStatus(response.status));
      try {
        return ok(await response.json());
      } catch {
        return err(providerError("unavailable", "provider returned an unreadable response"));
      }
    })();
    const outcome = await Promise.race([call, timedOut]);
    return outcome === "timeout" ? timeoutError() : outcome;
  } catch {
    return controller.signal.aborted
      ? timeoutError()
      : err(providerError("unavailable", "provider unreachable"));
  } finally {
    clearTimeout(timer);
  }
}
