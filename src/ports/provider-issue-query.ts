import type { ProviderIssue } from "../domain/settings/provider-status";

/** Owner-scoped: failures currently visible in the owner's own jobs (retrying or failed). */
export interface ProviderIssueQuery {
  currentIssues(ownerId: string): Promise<ProviderIssue[]>;
}
