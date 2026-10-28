import { describe, expect, it } from "vitest";
import { defined } from "../../support/assert";
import {
  escapeMarkdown,
  exportFilename,
  renderMarkdown,
  type ExportData,
} from "../../../src/domain/search/markdown-export";

const data: ExportData = {
  title: "Weekly sync with Grace",
  status: "published",
  scheduledStartAt: "2026-11-03T08:00:00.000Z",
  timezone: "Europe/Paris",
  folderName: "Board updates",
  attendees: ["Ada Founder", "Grace Hopper"],
  agenda: "Roadmap review",
  roughNotes: "ship beta in November",
  note: {
    status: "published",
    sections: [
      { heading: "Summary", body: "The team agreed." },
      { heading: "Risks", body: "Pricing deck pending." },
    ],
    decisions: ["Ship the beta in November."],
    actionItems: [
      {
        text: "Send the pricing deck",
        assignee: "Ada Founder",
        dueAt: "2026-11-07T22:59:59.999Z",
        dueTimezone: "Europe/Paris",
        done: true,
      },
      {
        text: "Draft the hiring plan",
        assignee: null,
        dueAt: null,
        dueTimezone: null,
        done: false,
      },
    ],
  },
};

describe("renderMarkdown", () => {
  it("renders the meeting, the summary, decisions and action items", () => {
    const md = renderMarkdown(data);
    expect(md).toContain("# Weekly sync with Grace");
    expect(md).toContain("- **When:** 2026-11-03 09:00 (Europe/Paris)");
    expect(md).toContain("- **Folder:** Board updates");
    expect(md).toContain("- **Attendees:** Ada Founder, Grace Hopper");
    expect(md).toContain("## Agenda\n\nRoadmap review");
    expect(md).toContain("## Rough notes\n\nship beta in November");
    expect(md).toContain("### Summary\n\nThe team agreed.");
    expect(md).toContain("## Decisions\n\n- Ship the beta in November.");
    expect(md).toContain("- [x] Send the pricing deck (owner: Ada Founder, due 2026-11-07)");
    expect(md).toContain("- [ ] Draft the hiring plan");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("says plainly when the summary is still a draft, so an export is never mistaken for a published note", () => {
    const md = renderMarkdown({
      ...data,
      status: "review",
      note: { ...defined(data.note), status: "draft" },
    });
    expect(md).toContain("**Status:** Draft summary, not yet published");
  });

  it("leaves out sections that do not exist", () => {
    const md = renderMarkdown({
      ...data,
      agenda: null,
      roughNotes: "",
      folderName: null,
      attendees: [],
      note: null,
    });
    expect(md).not.toContain("## Agenda");
    expect(md).not.toContain("## Rough notes");
    expect(md).not.toContain("Folder");
    expect(md).not.toContain("Attendees");
    expect(md).not.toContain("## Decisions");
  });

  it("never lets note text become structure, links, HTML or a formula", () => {
    const hostile = renderMarkdown({
      ...data,
      title: "# Pwned [click](javascript:alert(1))",
      agenda:
        "<script>alert(1)</script>\n=cmd|' /C calc'!A0\n- injected list\n1. numbered\n> quote",
      roughNotes: "![img](http://evil.test/x.png) `code` **bold** | pipe",
      note: {
        ...defined(data.note),
        sections: [{ heading: "## fake heading", body: "[a](b)\n---\n@SUM(1+1)" }],
        decisions: ["+cmd", "<img src=x onerror=1>"],
      },
    });
    for (const line of hostile.split("\n")) {
      expect(line).not.toMatch(/^#{1,6} (Pwned|fake)/);
      expect(line).not.toMatch(/^(=|\+|@)/);
      // A backslash-escaped angle bracket is literal text, so only an unescaped one is a risk.
      expect(line).not.toMatch(/(^|[^\\])[<>]/);
      expect(line).not.toMatch(/\]\(/);
      expect(line).not.toMatch(/^[-*+] injected/);
      expect(line).not.toMatch(/^\d+\. numbered/);
      expect(line).not.toMatch(/^> quote/);
      expect(line).not.toMatch(/^!\[/);
    }
  });
});

describe("escapeMarkdown", () => {
  it.each([
    ["*bold* _it_ `code`", "\\*bold\\* \\_it\\_ \\`code\\`"],
    ["[text](url)", "\\[text\\]\\(url\\)"],
    ["<b>x</b>", "\\<b\\>x\\</b\\>"],
    ["a | b", "a \\| b"],
    ["back\\slash", "back\\\\slash"],
    ["# heading", "\\# heading"],
    ["- item", "\\- item"],
    ["+ item", "\\+ item"],
    ["= x", "\\= x"],
    ["@x", "\\@x"],
    ["1. one", "1\\. one"],
    ["2) two", "2\\) two"],
    ["> quote", "\\> quote"],
    ["!bang", "\\!bang"],
    ["~~s~~", "\\~\\~s\\~\\~"],
  ])("escapes %j", (input, expected) => {
    expect(escapeMarkdown(input)).toBe(expected);
  });

  it("escapes at the start of every line, not only the first", () => {
    expect(escapeMarkdown("ok\n- not a list\n=cmd")).toBe("ok\n\\- not a list\n\\=cmd");
  });

  it("leaves ordinary prose alone", () => {
    expect(escapeMarkdown("Ship the beta in November, then hire two engineers.")).toBe(
      "Ship the beta in November, then hire two engineers.",
    );
  });
});

describe("exportFilename", () => {
  it("is ASCII, lower-case, safe and dated", () => {
    expect(exportFilename("Weekly sync with Grace", "2026-11-03T08:00:00.000Z")).toBe(
      "weekly-sync-with-grace-2026-11-03.md",
    );
  });

  it.each(["../../etc/passwd", 'a"b\r\nSet-Cookie: x=1', "Café ☃ 会議", "   ", ".hidden", "CON"])(
    "neutralizes %j",
    (title) => {
      const name = exportFilename(title, "2026-11-03T08:00:00.000Z");
      expect(name).toMatch(/^[a-z0-9][a-z0-9-]*-2026-11-03\.md$|^note-2026-11-03\.md$/);
      expect(name).not.toMatch(/[\r\n"/\\]/);
    },
  );

  it("limits the length", () => {
    expect(exportFilename("x".repeat(500), "2026-11-03T08:00:00.000Z").length).toBeLessThanOrEqual(
      80,
    );
  });
});
