import { describe, expect, it } from "vitest";
import { hitKindLabel } from "../../../src/domain/search/hit-link";
import {
  exportFilename,
  renderMarkdown,
  type ExportData,
} from "../../../src/domain/search/markdown-export";
import { parseSearchQuery } from "../../../src/domain/search/query";
import { defined } from "../../support/assert";
import { inLocale } from "../../support/locale";

// Search and the Markdown export in French (#121). English output is covered by the existing
// tests of these modules; here only the words the page language changes are asserted.

const NBSP = "\u00a0";

const data: ExportData = {
  title: "Point hebdo avec Grace",
  status: "published",
  scheduledStartAt: "2026-11-03T08:00:00.000Z",
  timezone: "Europe/Paris",
  folderName: "Comités",
  attendees: ["Ada Founder", "Grace Hopper"],
  agenda: "Revue de la feuille de route",
  roughNotes: "livrer la bêta en novembre",
  note: {
    status: "published",
    sections: [{ heading: "Risques", body: "Le support de prix est en attente." }],
    decisions: ["Livrer la bêta en novembre."],
    actionItems: [
      {
        text: "Envoyer le support de prix",
        assignee: "Ada Founder",
        dueAt: "2026-11-07T22:59:59.999Z",
        dueTimezone: "Europe/Paris",
        done: true,
      },
      {
        text: "Rédiger le plan de recrutement",
        assignee: null,
        dueAt: null,
        dueTimezone: null,
        done: false,
      },
    ],
  },
};

describe("search query messages in French", () => {
  it("says what to fix, in French, with the limits filled in", () => {
    const messageOf = (raw: unknown): string => {
      const parsed = inLocale("fr", () => parseSearchQuery(raw));
      if (parsed.ok) throw new Error("expected a refusal");
      return parsed.error.message;
    };
    expect(messageOf(undefined)).toBe("Saisissez quelque chose à rechercher.");
    expect(messageOf("   ")).toBe("Saisissez au moins un mot à rechercher.");
    expect(messageOf("a b c d e f g h i j k l m")).toBe("Utilisez 12 mots au maximum.");
    expect(messageOf("x".repeat(51))).toBe("Un mot peut compter 50 caractères au maximum.");
  });

  it("still turns what was typed into plain words (the language changes nothing about parsing)", () => {
    expect(inLocale("fr", () => parseSearchQuery('"réunion" OR -budget*'))).toEqual({
      ok: true,
      value: ["réunion", "OR", "budget"],
    });
  });
});

describe("hit labels in French", () => {
  it.each([
    ["meeting", "Titre, ordre du jour ou notes brutes", "Title, agenda or rough notes"],
    ["note_section", "Section du résumé", "Summary section"],
    ["decision", "Décision", "Decision"],
    ["action_item", "Action", "Action item"],
    ["anything_else", "Note", "Note"],
  ])("%s", (kind, french, english) => {
    expect(inLocale("fr", () => hitKindLabel(kind))).toBe(french);
    // Outside a French request it is the English text, unchanged.
    expect(hitKindLabel(kind)).toBe(english);
  });
});

describe("renderMarkdown in French", () => {
  it("translates the fixed labels and writes dates day first, and leaves the owner's words alone", () => {
    const md = inLocale("fr", () => renderMarkdown(data));
    expect(md).toContain("# Point hebdo avec Grace");
    expect(md).toContain(`- **Quand${NBSP}:** 03/11/2026 09:00 (Europe/Paris)`);
    expect(md).toContain(`- **Statut${NBSP}:** Publiée`);
    expect(md).toContain(`- **Dossier${NBSP}:** Comités`);
    expect(md).toContain(`- **Participants${NBSP}:** Ada Founder, Grace Hopper`);
    expect(md).toContain("## Ordre du jour\n\nRevue de la feuille de route");
    expect(md).toContain("## Notes brutes\n\nlivrer la bêta en novembre");
    expect(md).toContain("## Résumé\n\n### Risques\n\nLe support de prix est en attente.");
    expect(md).toContain("## Décisions\n\n- Livrer la bêta en novembre.");
    expect(md).toContain(
      `## Actions\n\n- [x] Envoyer le support de prix (responsable${NBSP}: Ada Founder, échéance${NBSP}: 07/11/2026)`,
    );
    expect(md).toContain("- [ ] Rédiger le plan de recrutement");
    // No English label survives.
    expect(md).not.toMatch(
      /\*\*(When|Status|Folder|Attendees):|## (Agenda|Summary|Decisions|Action items)|owner:|due /,
    );
  });

  it("says plainly that a draft is not published, and when there is no summary, in French", () => {
    const draft = inLocale("fr", () =>
      renderMarkdown({
        ...data,
        status: "review",
        note: { ...defined(data.note), status: "draft" },
      }),
    );
    expect(draft).toContain(`**Statut${NBSP}:** Brouillon de résumé, pas encore publié`);
    const none = inLocale("fr", () => renderMarkdown({ ...data, status: "scheduled", note: null }));
    expect(none).toContain(`**Statut${NBSP}:** Pas encore de résumé`);
  });

  it("escapes what the owner wrote exactly as in English: a translated file is no easier to inject into", () => {
    const hostile: ExportData = {
      ...data,
      title: "# Titre <script>alert(1)</script>",
      folderName: "[lien](http://x)",
      roughNotes: '=HYPERLINK("http://evil")\n- liste',
      note: { ...defined(data.note), decisions: ["**gras** | cellule"] },
    };
    const fr = inLocale("fr", () => renderMarkdown(hostile));
    expect(fr).toContain("# \\# Titre \\<script\\>alert\\(1\\)\\</script\\>");
    expect(fr).toContain(`**Dossier${NBSP}:** \\[lien\\]\\(http://x\\)`);
    expect(fr).toContain('\\=HYPERLINK\\("http://evil"\\)\n\\- liste');
    expect(fr).toContain("- \\*\\*gras\\*\\* \\| cellule");
    expect(fr).not.toMatch(/^=|<script>/m);
  });

  it("keeps the file name ASCII and the same in both languages", () => {
    expect(inLocale("fr", () => exportFilename("Réunion été", "2026-11-03T08:00:00.000Z"))).toBe(
      "reunion-ete-2026-11-03.md",
    );
  });
});
