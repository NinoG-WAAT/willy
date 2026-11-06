/**
 * French for the lists: the page frame and its navigation, the Inbox, All notes, Folders and
 * Templates, the note card and header, the pager, the template form and the messages behind them.
 * Typography (docs/I18N.md section 13): a no-break space (U+00A0) before ":", ";", "?" and "!",
 * and U+2019 as the apostrophe.
 */
export const fr: Record<string, string> = {
  // The page frame (src/layouts/Base.astro) and the navigation (src/components/nav-current.ts)
  Main: "Navigation principale",
  "New note": "Nouvelle note",
  Inbox: "Boîte de réception",
  "All notes": "Toutes les notes",
  Search: "Rechercher",
  Folders: "Dossiers",
  Templates: "Modèles",
  Settings: "Paramètres",
  "No folders yet": "Aucun dossier pour l’instant",
  "All folders": "Tous les dossiers",
  "Signed in as {name}": "Connecté en tant que {name}",
  "Sign out": "Se déconnecter",
  More: "Plus",
  "{n} note": "{n} note",
  "{n} notes": "{n} notes",

  // Inbox (src/pages/index.astro)
  "Showing {shown} of {total}.": "Affichage de {shown} sur {total}.",
  "Importing from your calendar…": "Import depuis votre calendrier…",
  "Import from calendar": "Importer depuis le calendrier",
  "Import from ICS file": "Importer un fichier ICS",
  "What needs you: published notes are in your folders and in All notes.":
    "À traiter : les notes publiées se trouvent dans vos dossiers et dans Toutes les notes.",
  "Open a folder": "Ouvrir un dossier",
  "Search your notes": "Rechercher dans vos notes",
  "In progress": "En cours",
  "Nothing is recording or being processed.": "Aucun enregistrement ni traitement en cours.",
  "Go to upcoming notes": "Aller aux notes à venir",
  "Nothing scheduled.": "Rien de planifié.",
  "Create a note": "Créer une note",
  "Import a calendar file": "Importer un fichier de calendrier",
  "Drafts to review": "Brouillons à relire",
  "No draft is waiting. A note appears here when its transcript has been summarised.":
    "Aucun brouillon en attente. Une note apparaît ici lorsque sa transcription a été résumée.",
  "Browse all notes": "Parcourir toutes les notes",
  "See all notes": "Voir toutes les notes",
  "See all drafts": "Voir tous les brouillons",
  "Past and not started": "Passées et non démarrées",

  // All notes (src/pages/notes/index.astro)
  All: "Toutes",
  "{n} note, newest first.": "{n} note, la plus récente d’abord.",
  "{n} notes, newest first.": "{n} notes, les plus récentes d’abord.",
  "Open the folder": "Ouvrir le dossier",
  "Filter by status": "Filtrer par statut",
  Status: "Statut",
  "Filter by folder": "Filtrer par dossier",
  Folder: "Dossier",
  "No notes match": "Aucune note ne correspond",
  "There are no notes for this filter.": "Aucune note ne correspond à ce filtre.",
  "Clear filters": "Effacer les filtres",
  "No notes yet": "Aucune note pour l’instant",
  "Create a note for a meeting you are about to have. Nothing is recorded until you confirm consent.":
    "Créez une note pour une réunion à venir. Rien n’est enregistré tant que vous n’avez pas confirmé le consentement.",

  // Folders (src/pages/folders)
  "Folders are private to you. You choose one when you publish a note, so finished notes stay organised. Open a folder to read the notes inside it.":
    "Les dossiers sont privés. Vous en choisissez un lorsque vous publiez une note, afin que les notes terminées restent organisées. Ouvrez un dossier pour lire les notes qu’il contient.",
  "New folder": "Nouveau dossier",
  "Folder name": "Nom du dossier",
  "Create folder": "Créer le dossier",
  "Your folders": "Vos dossiers",
  "You have no folders yet. Create one above, then pick it when you publish a note.":
    "Vous n’avez pas encore de dossier. Créez-en un ci-dessus, puis choisissez-le lorsque vous publiez une note.",
  "New name for folder {name}": "Nouveau nom du dossier {name}",
  Rename: "Renommer",
  Delete: "Supprimer",
  // Read after "Delete" / "Edit" / "Make default" for a screen reader, hence the article.
  "folder {name}": "le dossier {name}",
  "template {name}": "le modèle {name}",
  "Delete folder {name}": "Supprimer le dossier {name}",
  "Delete folder": "Supprimer le dossier",
  "You are about to delete the folder {name}.":
    "Vous êtes sur le point de supprimer le dossier {name}.",
  "Scope: only the folder itself is removed. Notes are never deleted by this action, which is why a folder that still contains notes cannot be deleted.":
    "Portée : seul le dossier lui-même est supprimé. Les notes ne sont jamais supprimées par cette action, c’est pourquoi un dossier qui contient encore des notes ne peut pas être supprimé.",
  "This folder contains {n} note.": "Ce dossier contient {n} note.",
  "This folder contains {n} notes.": "Ce dossier contient {n} notes.",
  "Back to folders": "Retour aux dossiers",
  Cancel: "Annuler",
  Breadcrumb: "Fil d’Ariane",
  "Private to you": "Privé",
  "Nothing published here yet": "Rien n’a encore été publié ici",
  "Publish a note to this folder from its review.":
    "Publiez une note dans ce dossier depuis sa relecture.",
  "Go to your meetings": "Aller à vos réunions",
  Notes: "Notes",

  // Templates (src/pages/settings/templates, src/components/TemplateForm.astro)
  "New template": "Nouveau modèle",
  "A template lists the sections of the note generated after a meeting, for example a weekly sync or a customer call. Pick one when you create a meeting, or set a default.":
    "Un modèle liste les sections de la note générée après une réunion, par exemple un point hebdomadaire ou un appel client. Choisissez-en un lorsque vous créez une réunion, ou définissez-en un par défaut.",
  "You have no templates yet. Until you create one, new notes use the built-in layout: {sections}.":
    "Vous n’avez pas encore de modèle. Tant que vous n’en créez pas, les nouvelles notes utilisent la mise en page intégrée : {sections}.",
  "None of your templates is the default, so new notes use the built-in layout: {sections}.":
    "Aucun de vos modèles n’est le modèle par défaut, donc les nouvelles notes utilisent la mise en page intégrée : {sections}.",
  Default: "Par défaut",
  "{n} section: {headings}.": "{n} section : {headings}.",
  "{n} sections: {headings}.": "{n} sections : {headings}.",
  "Used by {n} meeting.": "Utilisé par {n} réunion.",
  "Used by {n} meetings.": "Utilisé par {n} réunions.",
  Edit: "Modifier",
  "Make default": "Définir par défaut",
  "Create template": "Créer le modèle",
  "Edit template {name}": "Modifier le modèle {name}",
  "Edit template": "Modifier le modèle",
  "Save template": "Enregistrer le modèle",
  "Delete template {name}": "Supprimer le modèle {name}",
  "Delete template": "Supprimer le modèle",
  "You are about to delete the template {name}.":
    "Vous êtes sur le point de supprimer le modèle {name}.",
  "Scope: the template and its {n} section are removed. Meetings and notes are never deleted by this action.":
    "Portée : le modèle et sa {n} section sont supprimés. Les réunions et les notes ne sont jamais supprimées par cette action.",
  "Scope: the template and its {n} sections are removed. Meetings and notes are never deleted by this action.":
    "Portée : le modèle et ses {n} sections sont supprimés. Les réunions et les notes ne sont jamais supprimées par cette action.",
  "No meeting uses this template.": "Aucune réunion n’utilise ce modèle.",
  "{n} meeting uses this template. They keep their notes and fall back to your default template when a summary is regenerated.":
    "{n} réunion utilise ce modèle. Elle conserve sa note et revient à votre modèle par défaut lorsqu’un résumé est régénéré.",
  "{n} meetings use this template. They keep their notes and fall back to your default template when a summary is regenerated.":
    "{n} réunions utilisent ce modèle. Elles conservent leurs notes et reviennent à votre modèle par défaut lorsqu’un résumé est régénéré.",
  "It is your default template, so new notes will use the built-in layout afterwards.":
    "C’est votre modèle par défaut : ensuite, les nouvelles notes utiliseront la mise en page intégrée.",
  "Fix the following before saving:": "Corrigez les points suivants avant d’enregistrer :",
  "Template name": "Nom du modèle",
  Sections: "Sections",
  "Each section becomes a titled part of the generated note. The prompt tells the summary what belongs there. Leave a row empty to skip it, and clear a row to remove it.":
    "Chaque section devient une partie titrée de la note générée. L’instruction indique au résumé ce qui doit s’y trouver. Laissez une ligne vide pour l’ignorer, et videz une ligne pour la supprimer.",
  "Section {n}": "Section {n}",
  Heading: "Titre",
  "Prompt (optional)": "Instruction (facultative)",
  "Use as my default template for new meetings":
    "Utiliser comme mon modèle par défaut pour les nouvelles réunions",

  // Shared: errors and the pager
  "Fix the following before continuing:": "Corrigez les points suivants avant de continuer :",
  "Pages of notes": "Pages de notes",
  "Previous page": "Page précédente",
  "Next page": "Page suivante",
  "Page {page} of {pageCount}": "Page {page} sur {pageCount}",

  // The note card (src/components/MeetingCard.astro, src/domain/meetings/home.ts)
  "{n} attendee": "{n} participant",
  "{n} attendees": "{n} participants",
  "From your calendar": "Depuis votre calendrier",
  "Status:": "Statut :",
  "Consent:": "Consentement :",
  "for {title}": "pour {title}",

  // The note header (src/components/MeetingHeader.astro)
  "Not published": "Non publiée",
  "Where this note lives": "Où se trouve cette note",
  "Note stage": "Étape de la note",
  "This note is archived.": "Cette note est archivée.",

  // Messages from the application layer
  "Enter a folder name.": "Saisissez un nom de dossier.",
  "Folder names can be at most {max} characters.":
    "Un nom de dossier ne peut pas dépasser {max} caractères.",
  "Enter a template name.": "Saisissez un nom de modèle.",
  "Template names can be at most {max} characters.":
    "Un nom de modèle ne peut pas dépasser {max} caractères.",
  "Give this section a heading.": "Donnez un titre à cette section.",
  "Headings can be at most {max} characters.": "Un titre ne peut pas dépasser {max} caractères.",
  "Each section needs a different heading.": "Chaque section doit avoir un titre différent.",
  "Prompts can be at most {max} characters.":
    "Une instruction ne peut pas dépasser {max} caractères.",
  "Add at least one section.": "Ajoutez au moins une section.",
  "A template can have at most {max} sections.": "Un modèle peut avoir au plus {max} sections.",
  "You already have a folder with that name.": "Vous avez déjà un dossier portant ce nom.",
  "You already have a template with that name.": "Vous avez déjà un modèle portant ce nom.",
  "This folder still contains {n} note. Move or delete them first.":
    "Ce dossier contient encore {n} note. Déplacez-la ou supprimez-la d’abord.",
  "This folder still contains {n} notes. Move or delete them first.":
    "Ce dossier contient encore {n} notes. Déplacez-les ou supprimez-les d’abord.",
  "Folder created.": "Dossier créé.",
  "Folder renamed.": "Dossier renommé.",
  "Folder deleted.": "Dossier supprimé.",
  "Template created.": "Modèle créé.",
  "Template saved.": "Modèle enregistré.",
  "Default template updated.": "Modèle par défaut mis à jour.",
  "Template deleted.": "Modèle supprimé.",
  "Regenerating this section. It will update here when it is ready.":
    "Régénération de cette section en cours. Elle sera mise à jour ici dès qu’elle sera prête.",
  "Note created. It appears under Upcoming.": "Note créée. Elle apparaît sous « À venir ».",
  "Calendar import finished.": "Import du calendrier terminé.",
  "Your calendar has no upcoming events to import.":
    "Votre calendrier ne contient aucun événement à venir à importer.",
  "Imported {n} new meeting.": "{n} nouvelle réunion importée.",
  "Imported {n} new meetings.": "{n} nouvelles réunions importées.",
  "{n} event was already in your list.": "{n} événement figurait déjà dans votre liste.",
  "{n} events were already in your list.": "{n} événements figuraient déjà dans votre liste.",
  "Calendar file import finished.": "Import du fichier de calendrier terminé.",
  "Imported {n} new meeting from the calendar file.":
    "{n} nouvelle réunion importée depuis le fichier de calendrier.",
  "Imported {n} new meetings from the calendar file.":
    "{n} nouvelles réunions importées depuis le fichier de calendrier.",
  "Your calendar could not be reached. Nothing was changed and your notes are safe. Try again in a moment, or create a note manually.":
    "Votre calendrier n’a pas pu être joint. Rien n’a été modifié et vos notes sont en sécurité. Réessayez dans un instant, ou créez une note manuellement.",
  "The calendar service asked us to slow down. Wait a minute and try again.":
    "Le service de calendrier nous a demandé de ralentir. Patientez une minute puis réessayez.",
  "Your calendar is not connected, so events cannot be imported. You can still create a note manually.":
    "Votre calendrier n’est pas connecté, les événements ne peuvent donc pas être importés. Vous pouvez toujours créer une note manuellement.",
};

/** Strings that are the same word in French: English source -> why it is not translated. */
export const sameInFrench: Record<string, string> = {
  "{n} note": "Same word in French",
  "{n} notes": "Same word in French",
  Notes: "Same word in French",
  "Section {n}": "Same word in French",
  Sections: "Same word in French",
};
