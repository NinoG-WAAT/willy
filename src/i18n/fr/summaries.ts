/**
 * French for the built-in note layout and the summary job. The layout is only the starting point
 * for a new owner or a new template: a stored template keeps the headings its owner wrote.
 */
export const fr: Record<string, string> = {
  Default: "Par défaut",
  Summary: "Résumé",
  Discussion: "Discussion",
  "Next steps": "Prochaines étapes",
  "Summarize what was discussed in a few sentences.":
    "Résumez ce qui a été discuté en quelques phrases.",
  "List the main topics and what was said about each.":
    "Listez les principaux sujets et ce qui a été dit sur chacun.",
  "Note what happens next and who is involved.":
    "Indiquez la suite prévue et les personnes concernées.",
  // The stand-in text of the fake summarizer used in development and tests.
  "Covers {segments} transcript segments between positions {from} and {to}.":
    "Couvre {segments} segments de transcription entre les positions {from} et {to}.",
};

export const sameInFrench: Record<string, string> = {
  Discussion: "Same word in French",
};
