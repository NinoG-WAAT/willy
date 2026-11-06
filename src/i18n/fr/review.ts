/**
 * French for the review screen (src/pages/meetings/[id]/review.astro, src/components/review/*)
 * and the messages behind it (src/app/notes/review*, src/domain/notes/{review,outline,
 * action-chips,transcript-panel}). Strings that a client script can also show (job progress,
 * "Done", "Check again" sentences) live in scripts.ts: the server catalog includes it.
 *
 * Typography (docs/I18N.md section 13): ’ for apostrophes, U+00A0 before ":" ";" and inside « ».
 */
export const fr: Record<string, string> = {
  // src/app/notes/review-http.ts: notices after a redirect (fixed codes, never the URL)
  "Moved.": "Déplacée.",
  "Moved to {folder}.": "Déplacée vers {folder}.",
  "Already in that folder.": "Déjà dans ce dossier.",
  "Already in {folder}.": "Déjà dans {folder}.",
  "Section saved.": "Section enregistrée.",
  "Decision saved.": "Décision enregistrée.",
  "Decision added.": "Décision ajoutée.",
  "Decision removed from the draft.": "Décision retirée du brouillon.",
  "Action item saved.": "Action enregistrée.",
  "Action item added.": "Action ajoutée.",
  "Action item removed from the draft.": "Action retirée du brouillon.",
  "Action item marked as done.": "Action marquée comme terminée.",
  "Action item reopened.": "Action rouverte.",
  "Speaker renamed on every line of the transcript.":
    "Intervenant renommé sur toutes les lignes de la transcription.",
  "Speakers merged on every line of the transcript.":
    "Intervenants fusionnés sur toutes les lignes de la transcription.",
  "Lines assigned to the speaker.": "Lignes attribuées à l’intervenant.",
  "Published. This note is no longer a draft.": "Publiée. Cette note n’est plus un brouillon.",
  "Reopened. The note is a draft again and can be edited.":
    "Rouverte. La note est de nouveau un brouillon et peut être modifiée.",
  "Transcription restarted. Only the parts that failed are redone.":
    "Transcription relancée. Seules les parties en échec sont refaites.",
  "Regenerating the whole draft. It will update here when it is ready; your current draft stays until then.":
    "Régénération de tout le brouillon en cours. La page se mettra à jour ici quand ce sera prêt ; votre brouillon actuel reste en place d’ici là.",

  // src/app/notes/review-http.ts: problems shown above the form
  "Transcription can only be retried after it failed.":
    "La transcription ne peut être relancée qu’après un échec.",
  "That folder is not available. Choose one of your folders.":
    "Ce dossier n’est pas disponible. Choisissez l’un de vos dossiers.",
  "Only a published note can be moved to another folder. This one is not published right now; the page shows where things stand.":
    "Seule une note publiée peut être déplacée vers un autre dossier. Celle-ci n’est pas publiée pour le moment ; la page indique où en sont les choses.",
  "The note changed at the same moment. Check it below and try again.":
    "La note a changé au même moment. Vérifiez-la ci-dessous et réessayez.",
  "That was not saved. Fix the highlighted problem and try again.":
    "Rien n’a été enregistré. Corrigez le problème signalé et réessayez.",
  "This note is not an editable draft right now. Reopen it if it is published; the page shows where things stand.":
    "Cette note n’est pas un brouillon modifiable pour le moment. Rouvrez-la si elle est publiée ; la page indique où en sont les choses.",

  // src/app/notes/review.ts
  "Choose one of this meeting's attendees.": "Choisissez l’un des participants de cette réunion.",
  "That speaker is not in this transcript.":
    "Cet intervenant ne figure pas dans cette transcription.",
  "Some selected lines are not in this transcript. Reload the page and try again.":
    "Certaines lignes sélectionnées ne figurent pas dans cette transcription. Rechargez la page et réessayez.",
  "Tick the box to confirm you want to publish.": "Cochez la case pour confirmer la publication.",
  "Choose one of your folders.": "Choisissez l’un de vos dossiers.",

  // src/domain/notes/review.ts: validation
  "Use at most {max} characters.": "Utilisez {max} caractères au maximum.",
  "Write something.": "Écrivez quelque chose.",
  "Describe the decision.": "Décrivez la décision.",
  "Select at least one line.": "Sélectionnez au moins une ligne.",
  "Select at most {max} lines at a time.": "Sélectionnez {max} lignes au maximum à la fois.",
  "Some selected lines are not valid. Reload the page and try again.":
    "Certaines lignes sélectionnées ne sont pas valides. Rechargez la page et réessayez.",
  "Enter a name.": "Saisissez un nom.",
  "Describe the action.": "Décrivez l’action.",
  "Enter a real date.": "Saisissez une date valide.",

  // src/domain/notes/action-chips.ts
  "Due {day}": "Échéance : {day}",
  "Due {day} {year}": "Échéance : {day} {year}",
  Unknown: "Inconnu",
  Overdue: "En retard",

  // src/domain/notes/outline.ts
  "Source in the transcript": "Source dans la transcription",
  "{from} to {to}": "{from} à {to}",

  // src/domain/notes/transcript-panel.ts
  "Transcript, no lines": "Transcription : aucune ligne",
  "Transcript, {duration}, {n} line": "Transcription : {duration}, {n} ligne",
  "Transcript, {duration}, {n} lines": "Transcription : {duration}, {n} lignes",

  // src/pages/meetings/[id]/review.astro
  "Source: transcript {from} to {to}": "Source : transcription de {from} à {to}",
  "Review: {title}": "Relecture : {title}",
  "Export as Markdown": "Exporter en Markdown",
  "Rough notes": "Notes brutes",
  "Your transcript and summary are being prepared":
    "Votre transcription et votre résumé sont en cours de préparation",
  "This can take a few minutes.": "Cela peut prendre quelques minutes.",
  "Your rough notes are kept below.": "Vos notes brutes sont conservées ci-dessous.",
  "Transcription did not finish": "La transcription ne s’est pas terminée",
  "Nothing you wrote was lost.": "Rien de ce que vous avez écrit n’a été perdu.",
  "Retrying redoes only the parts that failed and never duplicates transcript lines.":
    "Relancer ne refait que les parties en échec et ne duplique jamais les lignes de la transcription.",
  "Retry transcription": "Relancer la transcription",
  "Your rough notes": "Vos notes brutes",
  "You did not take rough notes.": "Vous n’avez pas pris de notes brutes.",
  "Jump to the transcript": "Aller à la transcription",
  "Transcript and speakers": "Transcription et intervenants",
  "Transcript so far": "Transcription jusqu’ici",

  // src/components/review/ReviewActionItems.astro (and the shared field labels below)
  "Action items": "Actions",
  "No action items were recorded.": "Aucune action n’a été enregistrée.",
  Action: "Action",
  Owner: "Responsable",
  "No owner": "Aucun responsable",
  "Due date ({timezone})": "Date d’échéance ({timezone})",
  "Save action item": "Enregistrer l’action",
  ": {text}": " : {text}",
  Cancel: "Annuler",
  "editing this action item": "la modification de cette action",
  "Remove this action item": "Retirer cette action",
  "Removes only this action item from the draft. The transcript is untouched.":
    "Retire uniquement cette action du brouillon. La transcription n’est pas modifiée.",
  "Confirm: remove action item": "Confirmer : retirer l’action",
  "Mark done: {text}": "Marquer comme terminée : {text}",
  "Save status": "Enregistrer l’état",
  "To do": "À faire",
  "Done:": "Terminé :",
  "Search match": "Résultat de recherche",
  "Owner:": "Responsable :",
  "In {zone}": "Dans le fuseau {zone}",
  "Edited by you": "Modifié par vous",
  Edit: "Modifier",
  "action item: {text}": "l’action : {text}",
  "Add an action item": "Ajouter une action",
  "Add action item": "Ajouter l’action",
  "This meeting has no attendees, so action items cannot have an owner.":
    "Cette réunion n’a aucun participant : les actions ne peuvent donc pas avoir de responsable.",

  // src/components/review/ReviewDecisions.astro
  Decisions: "Décisions",
  "No decisions were recorded.": "Aucune décision n’a été enregistrée.",
  Decision: "Décision",
  "Save decision": "Enregistrer la décision",
  "editing this decision": "la modification de cette décision",
  "Remove this decision": "Retirer cette décision",
  "Removes only this decision from the draft. The transcript is untouched.":
    "Retire uniquement cette décision du brouillon. La transcription n’est pas modifiée.",
  "Confirm: remove decision": "Confirmer : retirer la décision",
  "decision: {text}": "la décision : {text}",
  "Add a decision": "Ajouter une décision",
  "Add decision": "Ajouter la décision",

  // src/components/review/ReviewMoveFolder.astro
  "Move to folder": "Déplacer vers un dossier",
  "You have no other folder to move this note to.":
    "Vous n’avez aucun autre dossier où déplacer cette note.",
  "Create a folder": "Créer un dossier",
  "Move this note to": "Déplacer cette note vers",
  "The note stays published and keeps its content. Only its folder changes.":
    "La note reste publiée et garde son contenu. Seul son dossier change.",
  Move: "Déplacer",

  // src/components/review/ReviewPublish.astro
  "Published to {folder} on {date}.": "Publiée dans {folder} le {date}.",
  "Published to {folder}.": "Publiée dans {folder}.",
  "Published on {date}.": "Publiée le {date}.",
  "Published.": "Publiée.",
  Publish: "Publier",
  Published: "Publiée",
  "Draft, not published": "Brouillon, non publié",
  "Publish to folder": "Publier dans un dossier",
  "This is a draft generated from the transcript. It stays a draft until you publish it.":
    "Ceci est un brouillon généré à partir de la transcription. Il reste un brouillon tant que vous ne l’avez pas publié.",
  "Private folder": "Dossier privé",
  "I have reviewed this note and want to publish it.":
    "J’ai relu cette note et je souhaite la publier.",
  "Publishing locks the note until you reopen it. It is never shared outside your folder.":
    "La publication verrouille la note jusqu’à ce que vous la rouvriez. Elle n’est jamais partagée en dehors de votre dossier.",
  "This version is read-only.": "Cette version est en lecture seule.",
  "Reopening turns it back into a draft so you can edit it. It stays unpublished until you publish again.":
    "La rouvrir la remet à l’état de brouillon pour que vous puissiez la modifier. Elle reste non publiée jusqu’à ce que vous la publiiez à nouveau.",
  "Reopen for editing": "Rouvrir pour modifier",
  "Publishing files the note in a private folder, and you have none yet.":
    "La publication range la note dans un dossier privé, et vous n’en avez pas encore.",
  "Then come back: your edits stay here.": "Revenez ensuite : vos modifications restent ici.",
  "This note is archived.": "Cette note est archivée.",
  "This note is not ready to publish.": "Cette note n’est pas prête à être publiée.",

  // src/components/review/ReviewSource.astro
  "Added by you: no transcript source.": "Ajouté par vous : aucune source dans la transcription.",

  // src/components/review/ReviewSpeakers.astro
  Speakers: "Intervenants",
  "No speakers were recognised.": "Aucun intervenant n’a été reconnu.",
  "{n} line": "{n} ligne",
  "{n} lines": "{n} lignes",
  "Rename or merge speakers": "Renommer ou fusionner des intervenants",
  "Speaker to rename": "Intervenant à renommer",
  "New name": "Nouveau nom",
  "Applies to every line of this transcript.":
    "S’applique à toutes les lignes de cette transcription.",
  "Rename speaker": "Renommer l’intervenant",
  "Merge this speaker": "Fusionner cet intervenant",
  into: "avec",
  "Their lines are relabelled to the second speaker. This applies to every line of this transcript.":
    "Leurs lignes sont réattribuées au second intervenant. Cela s’applique à toutes les lignes de cette transcription.",
  "Merge speakers": "Fusionner les intervenants",

  // src/components/review/ReviewSummary.astro
  "Meeting summary": "Résumé de la réunion",
  "Regenerate whole draft": "Régénérer tout le brouillon",
  "Writes the summary again from the transcript. It replaces every section, decision and action item, including your edits to them. Your rough notes, the transcript and the speaker names are kept, and the note stays a draft until you publish it.":
    "Rédige à nouveau le résumé à partir de la transcription. Il remplace chaque section, chaque décision et chaque action, y compris vos modifications. Vos notes brutes, la transcription et les noms des intervenants sont conservés, et la note reste un brouillon tant que vous ne la publiez pas.",
  "Replace my edits with a new draft.": "Remplacer mes modifications par un nouveau brouillon.",
  "Check again": "Vérifier à nouveau",
  "The summary has no sections.": "Le résumé n’a aucune section.",
  "Text of “{heading}”": "Texte de « {heading} »",
  Save: "Enregistrer",
  "section {heading}": "la section {heading}",
  "editing {heading}": "la modification de {heading}",
  Regenerate: "Régénérer",
  "Replaces only this section with a new draft from the transcript, including your edits to it.":
    "Remplace uniquement cette section par un nouveau brouillon issu de la transcription, y compris vos modifications.",
  "Regenerate this section": "Régénérer cette section",

  // src/components/review/ReviewTranscript.astro
  "Back to the summary": "Retour au résumé",
  "Tick the lines one person said, then give them a name. Lines can be moved to another speaker again later.":
    "Cochez les lignes dites par une même personne, puis donnez-lui un nom. Les lignes pourront être attribuées à un autre intervenant plus tard.",
  "Assign the ticked lines to": "Attribuer les lignes cochées à",
  Assign: "Attribuer",
  "No transcript lines were produced for this meeting.":
    "Aucune ligne de transcription n’a été produite pour cette réunion.",
  "Transcript lines": "Lignes de la transcription",
  "Select the line at {time} by {speaker}": "Sélectionner la ligne de {speaker} à {time}",
  Cited: "Citée",
  "This line could not be read.": "Cette ligne n’a pas pu être lue.",
};

/** Strings that are the same word in French: English source -> why it is not translated. */
export const sameInFrench: Record<string, string> = {
  Action: "Same word in French",
};
