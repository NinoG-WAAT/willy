import { canExportMeeting } from "../../domain/authz/predicates";
import { err, ok, type Result } from "../../domain/platform/result";
import { exportFilename, renderMarkdown } from "../../domain/search/markdown-export";
import type { NoteReader } from "../../ports/note-reader";

export interface ExportDeps {
  reader: NoteReader;
}

export interface MarkdownExport {
  filename: string;
  markdown: string;
}

/** Exports one of the Owner's meetings. Other owners' ids, guessed ids and deleting meetings are not_found. */
export async function exportMeetingMarkdown(
  deps: ExportDeps,
  ownerId: string,
  meetingId: string,
): Promise<Result<MarkdownExport, { kind: "not_found" }>> {
  const data = await deps.reader.loadForExport(ownerId, meetingId);
  if (!data || !canExportMeeting(ownerId, { ownerId, status: data.status })) {
    return err({ kind: "not_found" });
  }
  return ok({
    filename: exportFilename(data.title, data.scheduledStartAt),
    markdown: renderMarkdown(data),
  });
}
