/**
 * French for the Settings screens (hub, vocabulary, retention, permanent deletion, provider
 * status) and for the error pages: 404, session expired, signed out, and the documents built
 * outside Astro (403, 411/413, 429, 500). The deletion progress words are shared with the
 * browser script and live in `scripts.ts`. Typography: docs/I18N.md section 13, a no-break space
 * (U+00A0) before ":" "?" and inside « ».
 */
export const fr: Record<string, string> = {
  // Language (src/pages/settings/index.astro, src/domain/settings/language.ts)
  Language: "Langue",
  "Choose the language of the screens and dates. It applies to your account only.":
    "Choisissez la langue des écrans et des dates. Elle ne s’applique qu’à votre compte.",
  "Save language": "Enregistrer la langue",
  "Choose a language from the list.": "Choisissez une langue dans la liste.",

  // Notices after a redirect (src/app/settings/notices.ts)
  "Language saved.": "Langue enregistrée.",
  "Retention settings saved.": "Paramètres de conservation enregistrés.",
  "Deletion started. The meeting is already hidden everywhere. Its progress is shown below.":
    "Suppression lancée. La réunion est déjà masquée partout. Sa progression est affichée ci-dessous.",
  "That deletion was already requested. Its progress is shown below.":
    "Cette suppression a déjà été demandée. Sa progression est affichée ci-dessous.",
  "Deletion queued again. Its progress is shown below.":
    "Suppression remise en file d’attente. Sa progression est affichée ci-dessous.",
  "Nothing to retry: that deletion is not stopped.":
    "Rien à relancer : cette suppression n’est pas arrêtée.",
  "Words added. They are used for the next transcription.":
    "Mots ajoutés. Ils seront utilisés pour la prochaine transcription.",
  "Those words were already in your vocabulary. Nothing changed.":
    "Ces mots figuraient déjà dans votre vocabulaire. Rien n’a changé.",
  "Word removed.": "Mot retiré.",

  // Settings hub (src/pages/settings/index.astro)
  Settings: "Paramètres",
  "Provider status": "État des fournisseurs",
  "What Willycrumbs talks to, and whether it is working for you right now. Fake mode means a built-in stand-in is used and nothing leaves this server.":
    "Ce avec quoi Willycrumbs communique, et si cela fonctionne pour vous en ce moment. Le mode simulé signifie qu’un substitut intégré est utilisé et que rien ne quitte ce serveur.",
  "Last error:": "Dernière erreur :",
  Retention: "Conservation",
  "Currently: {audio}. {notes}.": "Actuellement : {audio}. {notes}.",
  "Raw audio": "Audio brut",
  "Raw audio is only needed to transcribe it. Keeping it longer stores more sensitive data.":
    "L’audio brut ne sert qu’à le transcrire. Le conserver plus longtemps stocke davantage de données sensibles.",
  "Notes and transcripts": "Notes et transcriptions",
  "When a period is set, meetings that are finished, published, archived or failed and older than it are deleted permanently and automatically, with their transcript and audio.":
    "Lorsqu’une durée est définie, les réunions terminées, publiées, archivées ou en échec qui sont plus anciennes sont supprimées définitivement et automatiquement, avec leur transcription et leur audio.",
  "I understand that meetings older than the period I choose are deleted permanently and automatically. Needed when you turn this on or make the period shorter.":
    "Je comprends que les réunions plus anciennes que la durée choisie sont supprimées définitivement et automatiquement. Nécessaire lorsque vous activez cette option ou raccourcissez la durée.",
  "Save retention": "Enregistrer la conservation",
  "Templates and folders": "Modèles et dossiers",
  "Templates set the sections of the note generated after a meeting. Folders are private places to publish finished notes.":
    "Les modèles définissent les sections de la note générée après une réunion. Les dossiers sont des espaces privés où publier les notes terminées.",
  "Edit templates": "Modifier les modèles",
  "Manage folders": "Gérer les dossiers",
  Vocabulary: "Vocabulaire",
  "Words your meetings use that a speech recogniser does not know: project names, clients, acronyms. They help it spell them correctly in the transcript.":
    "Les mots que vos réunions emploient et qu’un moteur de reconnaissance vocale ne connaît pas : noms de projets, clients, acronymes. Ils l’aident à les orthographier correctement dans la transcription.",
  "Edit vocabulary": "Modifier le vocabulaire",
  Export: "Exportation",
  "Every note can be exported to a Markdown file from its search result or from the list below. The export has the title, agenda, notes, decisions and action items. It never includes the transcript, audio or email addresses.":
    "Chaque note peut être exportée dans un fichier Markdown depuis son résultat de recherche ou depuis la liste ci-dessous. L’export contient le titre, l’ordre du jour, les notes, les décisions et les actions. Il n’inclut jamais la transcription, l’audio ni les adresses e-mail.",
  "Find a note to export": "Trouver une note à exporter",
  "Permanent deletion": "Suppression définitive",
  "Deleting a meeting destroys its note, transcript, audio and search entries, and cannot be undone. You confirm by typing a word on the next page. The meeting disappears at once; the files and records are then removed by a background job whose progress is shown here.":
    "Supprimer une réunion détruit sa note, sa transcription, son audio et ses entrées de recherche, et ne peut pas être annulé. Vous confirmez en saisissant un mot sur la page suivante. La réunion disparaît immédiatement ; les fichiers et les données sont ensuite supprimés par une tâche en arrière-plan dont la progression est affichée ici.",
  Deletions: "Suppressions",
  "No deletions yet.": "Aucune suppression pour le moment.",
  "Requested {when}": "Demandée le {when}",
  Reference: "Référence",
  "Finished {when}": "Terminée le {when}",
  "Retry deletion": "Réessayer la suppression",
  "for reference {id}": "pour la référence {id}",
  "A deletion is still running.": "Une suppression est encore en cours.",
  "Check again in a moment.": "Vérifiez à nouveau dans un instant.",
  "Delete a meeting": "Supprimer une réunion",
  "You have no meetings to delete.": "Vous n’avez aucune réunion à supprimer.",
  "Delete permanently": "Supprimer définitivement",

  // Retention wording (src/domain/settings/retention.ts)
  "Delete right after successful transcription (default)":
    "Supprimer juste après une transcription réussie (par défaut)",
  "Keep for {n} day after transcription": "Conserver {n} jour après la transcription",
  "Keep for {n} days after transcription": "Conserver {n} jours après la transcription",
  "Keep for {n} hour after transcription": "Conserver {n} heure après la transcription",
  "Keep for {n} hours after transcription": "Conserver {n} heures après la transcription",
  "Keep notes and transcripts until you delete them (default)":
    "Conserver les notes et les transcriptions jusqu’à ce que vous les supprimiez (par défaut)",
  "Permanently delete meetings {n} day after their scheduled start":
    "Supprimer définitivement les réunions {n} jour après leur début prévu",
  "Permanently delete meetings {n} days after their scheduled start":
    "Supprimer définitivement les réunions {n} jours après leur début prévu",
  "Choose how long raw audio is kept from the list.":
    "Choisissez dans la liste la durée de conservation de l’audio brut.",
  "Choose how long notes are kept from the list.":
    "Choisissez dans la liste la durée de conservation des notes.",
  "Tick the box to confirm that older meetings will be deleted permanently.":
    "Cochez la case pour confirmer que les réunions plus anciennes seront supprimées définitivement.",

  // Provider status (src/domain/settings/provider-status.ts)
  Calendar: "Calendrier",
  "Speech-to-text": "Reconnaissance vocale",
  "Summaries (LLM)": "Résumés (LLM)",
  "Audio storage": "Stockage audio",
  "Speech-to-text did not answer in time.": "La reconnaissance vocale n’a pas répondu à temps.",
  "Speech-to-text is unavailable.": "La reconnaissance vocale est indisponible.",
  "Speech-to-text rejected the request.": "La reconnaissance vocale a rejeté la demande.",
  "Speech-to-text asked us to slow down.": "La reconnaissance vocale nous a demandé de ralentir.",
  "The summary service did not answer in time.": "Le service de résumé n’a pas répondu à temps.",
  "The summary service is unavailable.": "Le service de résumé est indisponible.",
  "The summary service rejected the request.": "Le service de résumé a rejeté la demande.",
  "The summary service asked us to slow down.": "Le service de résumé nous a demandé de ralentir.",
  "Audio storage did not answer in time.": "Le stockage audio n’a pas répondu à temps.",
  "Audio storage is unavailable.": "Le stockage audio est indisponible.",
  "Audio storage rejected the request.": "Le stockage audio a rejeté la demande.",
  "Audio storage asked us to slow down.": "Le stockage audio nous a demandé de ralentir.",
  "Your calendar is not connected, so events cannot be imported.":
    "Votre calendrier n’est pas connecté : les événements ne peuvent pas être importés.",
  "The calendar could not be reached.": "Le calendrier n’a pas pu être joint.",
  "The provider reported a problem.": "Le fournisseur a signalé un problème.",
  Configured: "Configuré",
  Degraded: "Dégradé",
  "Fake mode": "Mode simulé",
  "Needs configuration": "À configurer",
  "Fake mode: a deterministic stand-in, no real provider is called":
    "Mode simulé : un substitut déterministe, aucun vrai fournisseur n’est appelé",
  "The configuration is incomplete or invalid": "La configuration est incomplète ou invalide",
  "Local disk": "Disque local",
  "Provider: {name}": "Fournisseur : {name}",
  "Provider: unknown": "Fournisseur : inconnu",

  // Vocabulary (src/pages/settings/vocabulary, src/components/vocabulary, the domain messages)
  Breadcrumb: "Fil d’Ariane",
  "Your words": "Vos mots",
  "Words your meetings use that a speech recogniser does not know: project names, clients, acronyms. They are given to it before it transcribes, so it spells them the way you do.":
    "Les mots que vos réunions emploient et qu’un moteur de reconnaissance vocale ne connaît pas : noms de projets, clients, acronymes. Ils lui sont transmis avant la transcription, afin qu’il les orthographie comme vous.",
  "No words yet. Add the names a transcript tends to get wrong, such as a product or a client.":
    "Aucun mot pour le moment. Ajoutez les noms qu’une transcription a tendance à mal écrire, comme un produit ou un client.",
  'A word marked "{label}" (it has a dot, a symbol or another sign that is not a letter, digit, space, hyphen or apostrophe) still helps the speech recogniser, but its spelling is not fixed afterwards in the transcript.':
    "Un mot marqué « {label} » (il contient un point, un symbole ou un autre signe qui n’est ni une lettre, ni un chiffre, ni une espace, ni un trait d’union, ni une apostrophe) aide quand même le moteur de reconnaissance vocale, mais son orthographe n’est pas corrigée ensuite dans la transcription.",
  "Not auto-corrected in transcripts": "Non corrigé automatiquement dans les transcriptions",
  "Used by the speech recogniser": "Utilisés par le moteur de reconnaissance vocale",
  "Left out": "Exclus",
  "The speech recogniser can read only about 600 characters of words, in the order of this list. These come last and do not fit. Remove words above to make room, or remove these.":
    "Le moteur de reconnaissance vocale ne peut lire qu’environ 600 caractères de mots, dans l’ordre de cette liste. Ceux-ci arrivent en dernier et ne tiennent pas. Retirez des mots plus haut pour faire de la place, ou retirez ceux-ci.",
  "Not sent": "Non transmis",
  Remove: "Retirer",
  "Add words": "Ajouter des mots",
  "Words to add": "Mots à ajouter",
  "One word or name per line, or several separated by commas. Up to {max} words, each at most {length} characters.":
    "Un mot ou un nom par ligne, ou plusieurs séparés par des virgules. Jusqu’à {max} mots, de {length} caractères au maximum chacun.",
  Add: "Ajouter",
  "Enter at least one word.": "Saisissez au moins un mot.",
  '"{word}" is too long: a word can have at most {max} characters.':
    "« {word} » est trop long : un mot peut compter {max} caractères au maximum.",
  '"{word}" contains a character that cannot be used in a word.':
    "« {word} » contient un caractère qui ne peut pas figurer dans un mot.",
  '"{word}" cannot start with a dash.': "« {word} » ne peut pas commencer par un tiret.",
  "That is too much text at once. Add fewer words.":
    "Il y a trop de texte à la fois. Ajoutez moins de mots.",
  "You can keep at most {max} words and you have {have}. Adding {adding} more would go over; nothing was added.":
    "Vous pouvez conserver {max} mots au maximum et vous en avez {have}. En ajouter {adding} de plus dépasserait la limite ; rien n’a été ajouté.",
  "{used} of {n} term is used by the speech recogniser.":
    "{used} mot sur {n} est utilisé par le moteur de reconnaissance vocale.",
  "{used} of {n} terms are used by the speech recogniser.":
    "{used} mots sur {n} sont utilisés par le moteur de reconnaissance vocale.",
  "{used} of {total} terms are used by the speech recogniser. {n} does not fit and is left out.":
    "{used} mots sur {total} sont utilisés par le moteur de reconnaissance vocale. {n} ne tient pas et est exclu.",
  "{used} of {total} terms are used by the speech recogniser. {n} do not fit and are left out.":
    "{used} mots sur {total} sont utilisés par le moteur de reconnaissance vocale. {n} ne tiennent pas et sont exclus.",

  // Permanent deletion page (src/pages/meetings/[id]/delete.astro)
  "Delete meeting permanently": "Supprimer définitivement la réunion",
  "You are about to delete {title}, scheduled for {when}.":
    "Vous êtes sur le point de supprimer la réunion « {title} », prévue le {when}.",
  "This meeting is recording right now. Deleting it stops the capture and discards what was recorded.":
    "Cette réunion est en cours d’enregistrement. La supprimer arrête l’enregistrement et efface ce qui a été enregistré.",
  "Something changed at the same moment, so nothing was deleted. Check the settings page, then try again.":
    "Quelque chose a changé au même moment : rien n’a été supprimé. Consultez la page des paramètres, puis réessayez.",
  "What will be destroyed": "Ce qui sera détruit",
  "The note: its summary sections, decisions and action items, as a draft or published.":
    "La note : ses sections de résumé, ses décisions et ses actions, en brouillon ou publiée.",
  "The transcript, including speaker corrections.":
    "La transcription, y compris les corrections d’intervenants.",
  "The audio: any raw audio chunks that are still stored.":
    "L’audio : tous les fragments d’audio brut encore stockés.",
  "The search entries for this meeting, so it no longer appears in any result.":
    "Les entrées de recherche de cette réunion, afin qu’elle n’apparaisse plus dans aucun résultat.",
  "Your rough notes, the agenda and the attendee list.":
    "Vos notes brutes, l’ordre du jour et la liste des participants.",
  "Only a short record that a deletion happened stays, with no title or text. Files you already exported or downloaded, and the event in your calendar, are not touched.":
    "Seule une courte trace indiquant qu’une suppression a eu lieu est conservée, sans titre ni texte. Les fichiers que vous avez déjà exportés ou téléchargés, ainsi que l’événement dans votre calendrier, ne sont pas touchés.",
  "This cannot be undone.": "Cette action est irréversible.",
  "The meeting disappears at once. A background job then removes the files and records, and you can follow it on the settings page.":
    "La réunion disparaît immédiatement. Une tâche en arrière-plan supprime ensuite les fichiers et les données, et vous pouvez la suivre dans la page des paramètres.",
  "Want a copy first?": "Besoin d’une copie avant ?",
  "Export this note to Markdown": "Exporter cette note en Markdown",
  "The export has no transcript or audio.": "L’export ne contient ni transcription ni audio.",
  "Deleting…": "Suppression en cours…",
  "Type {word} to confirm": "Saisissez {word} pour confirmer",
  "Type {word} in capital letters to confirm. Nothing was deleted.":
    "Saisissez {word} en majuscules pour confirmer. Rien n’a été supprimé.",
  Cancel: "Annuler",

  // Error pages built by Astro (404, session expired, signed out)
  "Not found": "Introuvable",
  "This page does not exist, or you do not have access to it.":
    "Cette page n’existe pas, ou vous n’y avez pas accès.",
  "Session expired": "Session expirée",
  "Your session expired": "Votre session a expiré",
  "For your security you were signed out after a period of inactivity. Your notes are safe.":
    "Pour votre sécurité, votre session a été fermée après une période d’inactivité. Vos notes sont en sécurité.",
  "Sign in again": "Se reconnecter",
  "Signed out": "Session fermée",
  "You are signed out": "Votre session est fermée",
  "Your session has ended on this device.": "Votre session s’est terminée sur cet appareil.",

  // Documents built outside Astro (src/app/platform/standalone-page.ts and its callers)
  "Back to your meetings": "Retour à vos réunions",
  "Request refused": "Demande refusée",
  "Your request could not be verified. Go back, reload the page and try again.":
    "Votre demande n’a pas pu être vérifiée. Revenez en arrière, rechargez la page et réessayez.",
  "Too many requests": "Trop de requêtes",
  "Please wait {n} second and try again.": "Veuillez patienter {n} seconde, puis réessayez.",
  "Please wait {n} seconds and try again.": "Veuillez patienter {n} secondes, puis réessayez.",
  "Upload too large": "Fichier trop volumineux",
  "Upload not accepted": "Envoi non accepté",
  "That upload is too large. Export a shorter date range from your calendar and try again.":
    "Ce fichier est trop volumineux. Exportez une période plus courte depuis votre calendrier, puis réessayez.",
  "That upload could not be sized. Try again from the import page.":
    "La taille de ce fichier n’a pas pu être déterminée. Réessayez depuis la page d’importation.",
  "Back to the calendar file import": "Retour à l’importation du fichier de calendrier",
  "Something went wrong": "Une erreur est survenue",
  "Your notes are safe. Try again in a moment.":
    "Vos notes sont en sécurité. Réessayez dans un instant.",
  "If it keeps happening, quote this reference:":
    "Si le problème persiste, indiquez cette référence :",
};

export const sameInFrench: Record<string, string> = {};
