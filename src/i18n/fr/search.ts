/**
 * French for search (the screen, its query messages and hit labels) and the Markdown export
 * (fixed labels; the owner's own text is never translated). Typography: docs/I18N.md section 13,
 * a no-break space (U+00A0) before ":" and inside « ».
 */
export const fr: Record<string, string> = {
  // src/pages/search.astro
  Search: "Rechercher",
  "Search: {terms}": "Recherche : {terms}",
  "Search the titles, agendas, rough notes, summaries, decisions and action items of your own meetings. Transcripts are not searched.":
    "Recherchez dans les titres, les ordres du jour, les notes brutes, les résumés, les décisions et les actions de vos propres réunions. Les transcriptions ne sont pas incluses dans la recherche.",
  "Search your notes": "Rechercher dans vos notes",
  Folder: "Dossier",
  "All folders": "Tous les dossiers",
  "Include archived": "Inclure les réunions archivées",
  "Find something you wrote or decided": "Retrouvez ce que vous avez écrit ou décidé",
  "Type a few words, for example a person, a project or a decision. Results show where the words appear.":
    "Saisissez quelques mots, par exemple une personne, un projet ou une décision. Les résultats indiquent où ces mots apparaissent.",
  Results: "Résultats",
  'No results for "{terms}". Check the spelling, try fewer words, or include archived meetings.':
    "Aucun résultat pour « {terms} ». Vérifiez l’orthographe, essayez avec moins de mots ou incluez les réunions archivées.",
  '{n} result for "{terms}".': "{n} résultat pour « {terms} ».",
  '{n} results for "{terms}".': "{n} résultats pour « {terms} ».",
  "{kind}: {label}": "{kind} : {label}",
  "Folder: {name}": "Dossier : {name}",
  Open: "Ouvrir",
  "Export Markdown": "Exporter en Markdown",
  "of {title}": "pour {title}",

  // src/domain/search/query.ts
  "Enter something to search for.": "Saisissez quelque chose à rechercher.",
  "Enter at least one word to search for.": "Saisissez au moins un mot à rechercher.",
  "Use at most {max} words.": "Utilisez {max} mots au maximum.",
  "Words can be at most {max} characters.": "Un mot peut compter {max} caractères au maximum.",

  // src/domain/search/hit-link.ts
  "Title, agenda or rough notes": "Titre, ordre du jour ou notes brutes",
  "Summary section": "Section du résumé",
  Decision: "Décision",
  "Action item": "Action",
  Note: "Note",

  // src/domain/search/markdown-export.ts (the file the owner downloads)
  "No summary yet": "Pas encore de résumé",
  Published: "Publiée",
  "Draft summary, not yet published": "Brouillon de résumé, pas encore publié",
  "When:": "Quand :",
  "Status:": "Statut :",
  "Folder:": "Dossier :",
  "Attendees:": "Participants :",
  Agenda: "Ordre du jour",
  "Rough notes": "Notes brutes",
  Summary: "Résumé",
  Decisions: "Décisions",
  "Action items": "Actions",
  "owner: {name}": "responsable : {name}",
  "due {date}": "échéance : {date}",
};

export const sameInFrench: Record<string, string> = {
  Note: "Same word in French",
};
