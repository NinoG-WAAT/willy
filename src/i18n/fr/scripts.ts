/**
 * French for client scripts (`src/scripts/**` and every module they import). This is the ONLY
 * catalog the browser downloads, so it holds only strings a script can show: the catalog test
 * fails if a client-reachable string is missing here, or if an entry here is not used by one.
 */
export const fr: Record<string, string> = {
  // src/components/format-instant.ts (job times in the progress script)
  "unknown time": "heure inconnue",

  // src/scripts/pending-submit.ts
  "Working…": "Traitement en cours…",

  // src/scripts/capture/notes-autosave.ts (rough notes autosave status)
  "Saved at {time}.": "Enregistré à {time}.",
  "Not saved: these notes are too long. Shorten them to save.":
    "Non enregistré : ces notes sont trop longues. Raccourcissez-les pour les enregistrer.",
  "Not saved: sign in again or reload the page. Your text is kept in this browser.":
    "Non enregistré : reconnectez-vous ou rechargez la page. Votre texte est conservé dans ce navigateur.",
  "Not saved yet. Retrying. Your text is kept in this browser.":
    "Pas encore enregistré. Nouvelle tentative en cours. Votre texte est conservé dans ce navigateur.",
  "Restored notes you typed but had not saved. Saving…":
    "Notes saisies mais non enregistrées restaurées. Enregistrement…",
  "Saving…": "Enregistrement…",

  // src/scripts/live-note.ts (microphone, upload and recording status)
  "This browser cannot record audio, so capture cannot start here. You can still take notes, or open this note in a current browser.":
    "Ce navigateur ne peut pas enregistrer l’audio : l’enregistrement ne peut donc pas démarrer ici. Vous pouvez quand même prendre des notes, ou ouvrir cette note dans un navigateur récent.",
  "Audio is waiting to upload. Check your connection. Your notes are safe and nothing recorded so far has been lost.":
    "L’audio attend d’être envoyé. Vérifiez votre connexion. Vos notes sont en sécurité et rien de ce qui a été enregistré jusqu’ici n’est perdu.",
  "The server did not accept part of the audio, so that part is missing from the transcript. Recording continues.":
    "Le serveur n’a pas accepté une partie de l’audio : cette partie manquera dans la transcription. L’enregistrement continue.",
  "Capture has ended on the server. Reload the page to see the current state.":
    "L’enregistrement est terminé côté serveur. Rechargez la page pour voir l’état actuel.",
  "This note is no longer capturing, so no more audio is accepted. Reload the page.":
    "Cette note n’est plus en cours d’enregistrement : plus aucun audio n’est accepté. Rechargez la page.",
  "Upload problem: {n} audio part is waiting.":
    "Problème d’envoi : {n} partie audio est en attente.",
  "Upload problem: {n} audio parts are waiting.":
    "Problème d’envoi : {n} parties audio sont en attente.",
  "Uploading audio… {n} part waiting.": "Envoi de l’audio… {n} partie en attente.",
  "Uploading audio… {n} parts waiting.": "Envoi de l’audio… {n} parties en attente.",
  "All recorded audio is uploaded.": "Tout l’audio enregistré a été envoyé.",
  "Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again. Your notes are not affected.":
    "L’accès au microphone a été bloqué. Autorisez le microphone pour ce site dans les paramètres de votre navigateur, puis réessayez. Vos notes ne sont pas affectées.",
  "No microphone was found. Connect one, then try again.":
    "Aucun microphone n’a été trouvé. Branchez-en un, puis réessayez.",
  "The microphone could not be started. Make sure no other app is using it, then try again.":
    "Le microphone n’a pas pu être démarré. Vérifiez qu’aucune autre application ne l’utilise, puis réessayez.",
  "Starting the microphone…": "Démarrage du microphone…",
  "Not recording in this browser.": "Aucun enregistrement dans ce navigateur.",
  "Try the microphone again": "Réessayer le microphone",
  "Not recording in this browser: the microphone was disconnected.":
    "Aucun enregistrement dans ce navigateur : le microphone a été déconnecté.",
  "The microphone stopped. Reconnect it, then try again.":
    "Le microphone s’est arrêté. Reconnectez-le, puis réessayez.",
  "The microphone is on in this browser.": "Le microphone est activé dans ce navigateur.",
  "No sound detected. Check that the right microphone is selected.":
    "Aucun son détecté. Vérifiez que le bon microphone est sélectionné.",
  "The microphone is picking up sound.": "Le microphone capte du son.",
  "{n} audio part is not uploaded yet. Retry the upload, or continue anyway and lose that audio.":
    "{n} partie audio n’a pas encore été envoyée. Réessayez l’envoi, ou continuez quand même et perdez cet audio.",
  "{n} audio parts are not uploaded yet. Retry the upload, or continue anyway and lose that audio.":
    "{n} parties audio n’ont pas encore été envoyées. Réessayez l’envoi, ou continuez quand même et perdez cet audio.",
  "Stop anyway": "Arrêter quand même",
  "Pause anyway": "Mettre en pause quand même",
  "Not recording in this browser: it cannot record audio.":
    "Aucun enregistrement dans ce navigateur : il ne peut pas enregistrer l’audio.",
  "This browser cannot record audio. Open this note in a current browser to continue capturing, or stop capture.":
    "Ce navigateur ne peut pas enregistrer l’audio. Ouvrez cette note dans un navigateur récent pour poursuivre l’enregistrement, ou arrêtez l’enregistrement.",
  "Capture is running, but this browser is not recording.":
    "L’enregistrement est en cours, mais ce navigateur n’enregistre pas.",
  "This note is being captured on another device or tab, or recording stopped here after a reload. Record from this browser to continue.":
    "Cette note est enregistrée sur un autre appareil ou un autre onglet, ou l’enregistrement s’est arrêté ici après un rechargement. Enregistrez depuis ce navigateur pour continuer.",
  "Record from this browser": "Enregistrer depuis ce navigateur",
  // src/domain/settings/deletion-status.ts and the deletions panel of src/scripts/job-progress.ts
  Queued: "En attente",
  "The meeting is already hidden. Removing its files and records has not started yet.":
    "La réunion est déjà masquée. La suppression de ses fichiers et de ses données n’a pas encore commencé.",
  Deleting: "Suppression en cours",
  "The meeting is already hidden. Its files and records are being removed.":
    "La réunion est déjà masquée. Ses fichiers et ses données sont en cours de suppression.",
  Retrying: "Nouvelle tentative",
  "Attempt {attempt} of {max} did not finish{reason}. It will try again automatically.":
    "La tentative {attempt} sur {max} n’a pas abouti{reason}. Une nouvelle tentative aura lieu automatiquement.",
  Failed: "Échec",
  "Deletion stopped after {n} attempt{reason}. The meeting stays hidden. It will be retried automatically within the hour, or you can retry now.":
    "La suppression s’est arrêtée après {n} tentative{reason}. La réunion reste masquée. Elle sera relancée automatiquement dans l’heure, ou vous pouvez réessayer maintenant.",
  "Deletion stopped after {n} attempts{reason}. The meeting stays hidden. It will be retried automatically within the hour, or you can retry now.":
    "La suppression s’est arrêtée après {n} tentatives{reason}. La réunion reste masquée. Elle sera relancée automatiquement dans l’heure, ou vous pouvez réessayer maintenant.",
  Deleted: "Supprimée",
  "The note, transcript, audio and search entries are gone.":
    "La note, la transcription, l’audio et les entrées de recherche ont disparu.",
  "Deletion with reference {id}: {label}. {detail}":
    "Suppression de référence {id} : {label}. {detail}",
  "Next attempt: {when}": "Prochaine tentative : {when}",

  // src/domain/progress/text.ts (job progress, also rendered by the review page)
  "Not started": "Pas encore démarré",
  "Waiting to start": "En attente de démarrage",
  Running: "En cours",
  "Retrying (attempt {attempt} of {max})": "Nouvel essai (tentative {attempt} sur {max})",
  "Failed after {n} attempt": "Échec après {n} tentative",
  "Failed after {n} attempts": "Échec après {n} tentatives",
  "Failed after {n} attempt ({code})": "Échec après {n} tentative ({code})",
  "Failed after {n} attempts ({code})": "Échec après {n} tentatives ({code})",
  Done: "Terminé",
  "Transcript: {status}": "Transcription\u00a0: {status}",
  "Summary: {status}": "Résumé\u00a0: {status}",
  "Your draft is ready.": "Votre brouillon est prêt.",
  "Your draft is ready. Use Check again to open it.":
    "Votre brouillon est prêt. Utilisez «\u00a0Vérifier à nouveau\u00a0» pour l’ouvrir.",
  "Processing did not finish. Your rough notes are kept.":
    "Le traitement ne s’est pas terminé. Vos notes brutes sont conservées.",
  "Processing did not finish. Use Check again to see what happened and retry. Your rough notes are kept.":
    "Le traitement ne s’est pas terminé. Utilisez «\u00a0Vérifier à nouveau\u00a0» pour voir ce qui s’est passé et réessayer. Vos notes brutes sont conservées.",
  "This note has moved on. Use Check again to see where it is now.":
    "Cette note a avancé. Utilisez «\u00a0Vérifier à nouveau\u00a0» pour voir où elle en est.",
  "Regeneration: {status}.": "Régénération\u00a0: {status}.",
  "The new draft of the note is ready. Use Check again to see it.":
    "Le nouveau brouillon de la note est prêt. Utilisez «\u00a0Vérifier à nouveau\u00a0» pour le voir.",
  "The new draft of this section is ready. Use Check again to see it.":
    "Le nouveau brouillon de cette section est prêt. Utilisez «\u00a0Vérifier à nouveau\u00a0» pour le voir.",
  "It did not finish. Your previous draft is kept. Use Check again to see the details and try again.":
    "Il ne s’est pas terminé. Votre brouillon précédent est conservé. Utilisez «\u00a0Vérifier à nouveau\u00a0» pour voir les détails et réessayer.",
  "It did not finish. Use Check again to see the details and try again.":
    "Il ne s’est pas terminé. Utilisez «\u00a0Vérifier à nouveau\u00a0» pour voir les détails et réessayer.",
  "{title}: status changed to {status}.": "{title}\u00a0: le statut est passé à {status}.",
  "Live updates stopped because the status could not be checked. Use Check again to see the latest.":
    "Les mises à jour en direct se sont arrêtées, car l’état n’a pas pu être vérifié. Utilisez «\u00a0Vérifier à nouveau\u00a0» pour voir la dernière version.",
  "Live updates stopped after a while. Use Check again to see the latest.":
    "Les mises à jour en direct se sont arrêtées au bout d’un moment. Utilisez «\u00a0Vérifier à nouveau\u00a0» pour voir la dernière version.",
  "Live updates stopped. Use Check again, or sign in again, to see the latest.":
    "Les mises à jour en direct se sont arrêtées. Utilisez «\u00a0Vérifier à nouveau\u00a0», ou connectez-vous de nouveau, pour voir la dernière version.",

  // src/scripts/job-progress.ts
  "Draft ready: {title}": "Brouillon prêt\u00a0: {title}",
  "A meeting": "Une réunion",

  // src/scripts/review.ts
  "The cited transcript lines are not available.":
    "Les lignes de transcription citées ne sont pas disponibles.",
  "{n} cited transcript line is marked.": "{n} ligne de transcription citée est marquée.",
  "{n} cited transcript lines are marked.": "{n} lignes de transcription citées sont marquées.",
  "{n} line selected.": "{n} ligne sélectionnée.",
  "{n} lines selected.": "{n} lignes sélectionnées.",
};

export const sameInFrench: Record<string, string> = {};
