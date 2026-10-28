import type { DiagnosticsRepository } from "../../ports/diagnostics-repository";
import type { JobStatus } from "../../ports/job-repository";

export interface ProviderModes {
  speechToText: string;
  summaries: string;
  calendar: string;
  storage: string;
}

export interface DiagnosticsDeps {
  diagnostics: DiagnosticsRepository;
  providers: ProviderModes;
}

export interface Diagnostics {
  migration: { latest: string | null };
  jobs: Record<JobStatus, number>;
  providers: ProviderModes;
}

/**
 * Operational snapshot for the signed-in owner: schema version, their own job counts and which
 * providers are real or fake (honest about "fake" mode). Counts and mode names only: no content,
 * secrets, hosts, error text or other owners' data (CLAUDE.md A05: diagnostics never expose data).
 */
export async function getDiagnostics(deps: DiagnosticsDeps, ownerId: string): Promise<Diagnostics> {
  return {
    migration: { latest: await deps.diagnostics.latestMigration() },
    jobs: await deps.diagnostics.jobCounts(ownerId),
    providers: deps.providers,
  };
}
