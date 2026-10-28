import type { MeetingStatus } from "../meetings/lifecycle";

export interface ExportActionItem {
  text: string;
  assignee: string | null;
  dueAt: string | null;
  dueTimezone: string | null;
  done: boolean;
}

export interface ExportNote {
  status: "draft" | "published";
  sections: { heading: string; body: string }[];
  decisions: string[];
  actionItems: ExportActionItem[];
}

/** What an export may contain: names, never emails; no transcript, no audio. */
export interface ExportData {
  title: string;
  status: MeetingStatus;
  scheduledStartAt: string;
  timezone: string;
  folderName: string | null;
  attendees: string[];
  agenda: string | null;
  roughNotes: string;
  note: ExportNote | null;
}

const GENERAL = /[\\`*_[\]()<>#|~!&]/g;

/**
 * Makes untrusted text inert in Markdown: structure characters are backslash-escaped everywhere,
 * and line starts that would form lists, headings, setext underlines or spreadsheet formulas
 * (`-`, `+`, `=`, `@`, `1.`) are escaped too. The note says what the owner wrote and nothing else:
 * it cannot become a heading, a link, an image, HTML or a formula in whatever opens the file.
 */
export function escapeMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(GENERAL, "\\$&")
        .replace(/^(\s*)([-+=@])/, "$1\\$2")
        .replace(/^(\s*\d+)\./, "$1\\."),
    )
    .join("\n");
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function wallClock(utc: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone(timeZone),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utc));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function noteState(note: ExportNote | null): string {
  if (note === null) return "No summary yet";
  return note.status === "published" ? "Published" : "Draft summary, not yet published";
}

/** Renders one meeting and its note as Markdown. Pure: the output depends only on `data`. */
export function renderMarkdown(data: ExportData): string {
  const when = wallClock(data.scheduledStartAt, data.timezone);
  const lines: string[] = [`# ${escapeMarkdown(oneLine(data.title))}`, ""];
  lines.push(`- **When:** ${when.date} ${when.time} (${escapeMarkdown(data.timezone)})`);
  lines.push(`- **Status:** ${noteState(data.note)}`);
  if (data.folderName !== null)
    lines.push(`- **Folder:** ${escapeMarkdown(oneLine(data.folderName))}`);
  if (data.attendees.length > 0) {
    lines.push(
      `- **Attendees:** ${data.attendees.map((a) => escapeMarkdown(oneLine(a))).join(", ")}`,
    );
  }
  lines.push("");

  const block = (heading: string, text: string | null): void => {
    if (text === null || text.trim() === "") return;
    lines.push(`## ${heading}`, "", escapeMarkdown(text.trim()), "");
  };
  block("Agenda", data.agenda);
  block("Rough notes", data.roughNotes);

  const { note } = data;
  if (note !== null) {
    if (note.sections.length > 0) {
      lines.push("## Summary", "");
      for (const section of note.sections) {
        lines.push(
          `### ${escapeMarkdown(oneLine(section.heading))}`,
          "",
          escapeMarkdown(section.body.trim()),
          "",
        );
      }
    }
    if (note.decisions.length > 0) {
      lines.push("## Decisions", "");
      for (const decision of note.decisions) {
        lines.push(`- ${escapeMarkdown(decision.trim()).replace(/\n/g, "\n  ")}`);
      }
      lines.push("");
    }
    if (note.actionItems.length > 0) {
      lines.push("## Action items", "");
      for (const item of note.actionItems) {
        const meta: string[] = [];
        if (item.assignee !== null) meta.push(`owner: ${escapeMarkdown(oneLine(item.assignee))}`);
        if (item.dueAt !== null) {
          meta.push(`due ${wallClock(item.dueAt, item.dueTimezone ?? "UTC").date}`);
        }
        const suffix = meta.length > 0 ? ` (${meta.join(", ")})` : "";
        lines.push(`- [${item.done ? "x" : " "}] ${escapeMarkdown(oneLine(item.text))}${suffix}`);
      }
      lines.push("");
    }
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

/** ASCII, lower-case, dated and short: safe in a Content-Disposition header and on any file system. */
export function exportFilename(title: string, startsAtUtc: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return `${slug === "" ? "note" : slug}-${startsAtUtc.slice(0, 10)}.md`;
}
