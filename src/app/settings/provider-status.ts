import {
  describeProviders,
  type ProviderId,
  type ProviderIssue,
  type ProviderStatus,
} from "../../domain/settings/provider-status";
import type { ProviderIssueQuery } from "../../ports/provider-issue-query";

export interface ProviderStatusDeps {
  issues: ProviderIssueQuery;
  /** Configured mode per provider (names only, as in diagnostics). */
  modes: Readonly<Record<ProviderId, string>>;
  /** Problems known from configuration rather than from jobs (for example an unconnected calendar). */
  knownIssues: readonly ProviderIssue[];
}

/** Configured / degraded / fake / needs-configuration per provider, with the last redacted error. */
export async function loadProviderStatus(
  deps: ProviderStatusDeps,
  ownerId: string,
): Promise<ProviderStatus[]> {
  const fromJobs = await deps.issues.currentIssues(ownerId);
  return describeProviders(deps.modes, [...fromJobs, ...deps.knownIssues]);
}
