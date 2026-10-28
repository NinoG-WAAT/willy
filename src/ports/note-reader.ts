import type { ExportData } from "../domain/search/markdown-export";

/** Reads one meeting with its note for export. Owner-scoped. */
export interface NoteReader {
  /** Null for an unknown id, another owner's meeting, or a meeting being deleted. */
  loadForExport(ownerId: string, meetingId: string): Promise<ExportData | null>;
}
