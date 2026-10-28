import type { DatabaseSync } from "node:sqlite";
import type { ProviderIssue } from "../../domain/settings/provider-status";
import type { ProviderIssueQuery } from "../../ports/provider-issue-query";

const LIMIT = 100;

/** Codes and times from the owner's own failing jobs; no ids, payloads or content. */
export class SqliteProviderIssueQuery implements ProviderIssueQuery {
  constructor(private readonly db: DatabaseSync) {}

  currentIssues(ownerId: string): Promise<ProviderIssue[]> {
    const rows = this.db
      .prepare(
        `SELECT last_error_code, updated_at FROM job
          WHERE owner_id = ? AND status IN ('retrying', 'failed') AND last_error_code IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT ?`,
      )
      .all(ownerId, LIMIT);
    return Promise.resolve(
      rows.map((r) => ({ code: String(r["last_error_code"]), at: String(r["updated_at"]) })),
    );
  }
}
