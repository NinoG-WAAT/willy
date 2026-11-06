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
};

export const sameInFrench: Record<string, string> = {};
