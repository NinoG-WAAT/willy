/**
 * French for the new note form, the live note, the calendar and ICS import, and the messages the
 * domain and app layers create for them (#119). Strings that a client script can also show
 * (the microphone, upload and autosave messages) are in `scripts.ts`, which the server merges in.
 *
 * The consent statement is a faithful translation: the Owner still attests, for themselves, that
 * every participant was told and agreed. The rule itself is enforced by the server, not here.
 */
export const fr: Record<string, string> = {
  // src/domain/meetings/lifecycle.ts: the consent statement the Owner ticks
  "I have told every participant that this meeting will be recorded and transcribed, and I have their consent.":
    "J’ai informé chaque participant que cette réunion sera enregistrée et transcrite, et j’ai obtenu son consentement.",

  // src/pages/meetings/new.astro
  "New note": "Nouvelle note",
  "Create a note for a meeting. Nothing is recorded now: you confirm consent and start capture from the note itself.":
    "Créez une note pour une réunion. Rien n’est enregistré maintenant : vous confirmez le consentement et vous démarrez l’enregistrement depuis la note elle-même.",
  Title: "Titre",
  Date: "Date",
  "Start time": "Heure de début",
  "Duration (minutes)": "Durée (minutes)",
  "Time zone": "Fuseau horaire",
  "Agenda (optional)": "Ordre du jour (facultatif)",
  "Attendees (optional)": "Participants (facultatif)",
  "One per line: {name} <{email}>, an email, or just a name. Only list people who will be in the meeting. Listing someone here does not record their consent.":
    "Un par ligne : {name} <{email}>, une adresse e-mail ou simplement un nom. Ne listez que les personnes qui seront présentes à la réunion. Ajouter quelqu’un ici n’enregistre pas son consentement.",
  // The two words of the example shape "Name <email>": the parser takes any name before <...>.
  Name: "Nom",
  email: "adresse e-mail",
  Template: "Modèle",
  "My default ({name})": "Mon modèle par défaut ({name})",
  "Built-in layout": "Structure intégrée",
  "Sections of the note generated after the meeting.":
    "Sections de la note générées après la réunion.",
  "Manage templates": "Gérer les modèles",
  "Create note": "Créer la note",
  Cancel: "Annuler",

  // Validation (src/domain/meetings/new-meeting.ts, attendee.ts, src/app/meetings/create-meeting.ts)
  "Enter a valid date.": "Saisissez une date valide.",
  "Enter a valid time.": "Saisissez une heure valide.",
  "Choose a time zone from the list.": "Choisissez un fuseau horaire dans la liste.",
  "That time does not exist in this time zone (clocks move forward). Pick another time.":
    "Cette heure n’existe pas dans ce fuseau horaire (les horloges avancent). Choisissez une autre heure.",
  "Enter a title for the meeting.": "Saisissez un titre pour la réunion.",
  "Titles can be at most {max} characters.": "Un titre ne peut pas dépasser {max} caractères.",
  "The agenda can be at most {max} characters.":
    "L’ordre du jour ne peut pas dépasser {max} caractères.",
  "Duration must be between {min} and {max} minutes.":
    "La durée doit être comprise entre {min} et {max} minutes.",
  "Attendees must be a list.": "Les participants doivent former une liste.",
  "Add at most {max} attendees.": "Ajoutez au plus {max} participants.",
  "Unexpected attendee data.": "Données de participant inattendues.",
  "Attendee emails must be text.": "Les adresses e-mail des participants doivent être du texte.",
  '"{email}" is not a valid email address.': "« {email} » n’est pas une adresse e-mail valide.",
  "Attendee names can be at most {max} characters.":
    "Le nom d’un participant ne peut pas dépasser {max} caractères.",
  "This form expired. Reload the page and try again.":
    "Ce formulaire a expiré. Rechargez la page et réessayez.",
  "Choose one of your own templates.": "Choisissez l’un de vos propres modèles.",
  "Notes must be text.": "Les notes doivent être du texte.",
  "Notes can be at most {max} characters.": "Les notes ne peuvent pas dépasser {max} caractères.",

  // src/pages/meetings/[id]/index.astro (the live note)
  "Your notes were not saved: they are longer than {max} characters. What you typed is still below.":
    "Vos notes n’ont pas été enregistrées : elles dépassent {max} caractères. Ce que vous avez saisi figure toujours ci-dessous.",
  "Capture did not start. Tick the consent statement first: nothing is recorded until you confirm it.":
    "L’enregistrement n’a pas démarré. Cochez d’abord la déclaration de consentement : rien n’est enregistré tant que vous ne l’avez pas confirmée.",
  "The note changed at the same moment. Check its state below and try again.":
    "La note a changé au même moment. Vérifiez son état ci-dessous et réessayez.",
  "That action is not available in the note's current state. The page shows where things stand.":
    "Cette action n’est pas disponible dans l’état actuel de la note. La page indique où en sont les choses.",
  "Notes saved.": "Notes enregistrées.",
  "Recording finished. A draft is ready for review.":
    "Enregistrement terminé. Un brouillon est prêt à être relu.",
  Published: "Publiée",
  "Recording finished, but processing needs attention.":
    "Enregistrement terminé, mais le traitement nécessite votre attention.",
  Recording: "Enregistrement en cours",
  "Recording paused": "Enregistrement en pause",
  "This note is being captured.": "Cette note est en cours d’enregistrement.",
  "Capture is paused. Nothing is being recorded.":
    "L’enregistrement est en pause. Rien n’est enregistré.",
  "Export as Markdown": "Exporter en Markdown",
  Capture: "Enregistrement",
  "Only you can confirm this. Willycrumbs never records anyone's consent for them, and nothing is captured until you start.":
    "Vous seul pouvez le confirmer. Willycrumbs n’enregistre jamais le consentement de quelqu’un à sa place, et aucun enregistrement n’a lieu tant que vous n’avez pas démarré.",
  "You confirmed consent on {when}.": "Vous avez confirmé le consentement le {when}.",
  "Start capture": "Démarrer l’enregistrement",
  "Audio capture needs JavaScript. Without it you can still take notes below.":
    "L’enregistrement audio nécessite JavaScript. Sans lui, vous pouvez quand même prendre des notes ci-dessous.",
  Pause: "Mettre en pause",
  Resume: "Reprendre",
  "Stop capture": "Arrêter l’enregistrement",
  "Stopping ends the recording and starts the transcript. You cannot resume this recording afterwards.":
    "L’arrêt met fin à l’enregistrement et lance la transcription. Vous ne pourrez pas reprendre cet enregistrement ensuite.",
  "Microphone input level": "Niveau d’entrée du microphone",
  "Retry upload": "Réessayer l’envoi",
  "Audio capture needs JavaScript, so no audio is being recorded in this browser. You can still take notes and stop capture.":
    "L’enregistrement audio nécessite JavaScript : aucun son n’est donc enregistré dans ce navigateur. Vous pouvez quand même prendre des notes et arrêter l’enregistrement.",
  "Transcription progress": "Progression de la transcription",
  "This can take a few minutes.": "Cela peut prendre quelques minutes.",
  "Check again": "Vérifier à nouveau",
  "Your rough notes are kept.": "Vos notes brutes sont conservées.",
  "Rough notes": "Notes brutes",
  "Your notes (saved as you type)": "Vos notes (enregistrées au fil de la saisie)",
  "All changes saved.": "Toutes les modifications sont enregistrées.",
  "Save notes": "Enregistrer les notes",
  Attendees: "Participants",
  "No attendees were added.": "Aucun participant n’a été ajouté.",
  Agenda: "Ordre du jour",
  "No agenda was added.": "Aucun ordre du jour n’a été ajouté.",

  // src/pages/meetings/import/ics.astro
  "Import from an ICS file": "Importer depuis un fichier ICS",
  "Export your meetings from Outlook or Teams as an .ics calendar file, then upload it here or paste its text. No calendar account, sign-in or app registration is needed. The file is read in memory and not stored. Links inside invitations stay plain text and are never opened.":
    "Exportez vos réunions depuis Outlook ou Teams sous la forme d’un fichier de calendrier .ics, puis importez-le ici ou collez son texte. Aucun compte de calendrier, aucune connexion ni aucune inscription d’application n’est nécessaire. Le fichier est lu en mémoire et n’est pas conservé. Les liens contenus dans les invitations restent du texte brut et ne sont jamais ouverts.",
  "How to export from Outlook or Teams": "Comment exporter depuis Outlook ou Teams",
  "Classic Outlook on Windows: in Calendar choose File, then Save Calendar, pick a date range and Full details, and save the .ics file. To save one meeting, open it, then File, Save As, and choose iCalendar Format.":
    "Outlook classique sous Windows : dans Calendrier, choisissez Fichier, puis Enregistrer le calendrier, sélectionnez une période et Détails complets, puis enregistrez le fichier .ics. Pour enregistrer une seule réunion, ouvrez-la, puis Fichier, Enregistrer sous, et choisissez le format iCalendar.",
  "Outlook on the web: Settings, Calendar, Shared calendars, Publish a calendar. Open the ICS link it gives you in your browser to download the file, then upload that file here.":
    "Outlook sur le web : Paramètres, Calendrier, Calendriers partagés, Publier un calendrier. Ouvrez dans votre navigateur le lien ICS qui vous est donné pour télécharger le fichier, puis importez ce fichier ici.",
  "Teams shows your Outlook calendar, so Teams meetings are in the same export. Recurring series are listed but not imported (only single meetings and changed occurrences are).":
    "Teams affiche votre calendrier Outlook : les réunions Teams figurent donc dans le même export. Les séries récurrentes sont listées mais pas importées (seules les réunions uniques et les occurrences modifiées le sont).",
  "Reading the calendar…": "Lecture du calendrier…",
  "Calendar file (.ics, up to 1 MB)": "Fichier de calendrier (.ics, 1 Mo maximum)",
  "Or paste the calendar text": "Ou collez le texte du calendrier",
  "Time zone for events that have none": "Fuseau horaire des événements qui n’en ont pas",
  "Outlook names the time zone of most events. This applies only to all-day events and to times that carry no zone.":
    "Outlook indique le fuseau horaire de la plupart des événements. Celui-ci s’applique uniquement aux événements sur la journée entière et aux heures sans fuseau.",
  "Preview events": "Prévisualiser les événements",
  Preview: "Aperçu",
  "Found {n} event in the file.": "{n} événement trouvé dans le fichier.",
  "Found {n} events in the file.": "{n} événements trouvés dans le fichier.",
  "{n} can be imported.": "Importables : {n}.",
  "Nothing has been imported yet.": "Rien n’a encore été importé.",
  "{n} recurring series was not expanded and will not be imported.":
    "{n} série récurrente n’a pas été développée et ne sera pas importée.",
  "{n} recurring series were not expanded and will not be imported.":
    "{n} séries récurrentes n’ont pas été développées et ne seront pas importées.",
  "Only single meetings and changed occurrences are imported.":
    "Seules les réunions uniques et les occurrences modifiées sont importées.",
  "{n} event was skipped:": "{n} événement a été ignoré :",
  "{n} events were skipped:": "{n} événements ont été ignorés :",
  "Nothing to import": "Rien à importer",
  "The file has no single meetings that can be imported.":
    "Le fichier ne contient aucune réunion unique pouvant être importée.",
  "Try another file": "Essayer un autre fichier",
  "Importing…": "Import en cours…",
  "Events to import": "Événements à importer",
  "{day}, all day": "{day}, toute la journée",
  "{when} ({n} min)": "{when} ({n} min)",
  "{n} attendee": "{n} participant",
  "{n} attendees": "{n} participants",
  "Cancelled in the calendar: not imported": "Annulé dans le calendrier : non importé",
  "Imported meetings appear under Upcoming with consent not yet confirmed. Listing someone as an attendee does not record their consent.":
    "Les réunions importées apparaissent sous « À venir » avec un consentement non encore confirmé. Ajouter quelqu’un comme participant n’enregistre pas son consentement.",
  "Every event in this file was cancelled, so there is nothing to import.":
    "Tous les événements de ce fichier ont été annulés : il n’y a donc rien à importer.",
  "Import selected events": "Importer les événements sélectionnés",
  "Start over": "Recommencer",

  // src/app/calendar/ics-messages.ts: why a file is refused
  "That file could not be read as a calendar export. Export it again from Outlook as an iCalendar (.ics) file.":
    "Ce fichier n’a pas pu être lu comme un export de calendrier. Exportez-le de nouveau depuis Outlook sous forme de fichier iCalendar (.ics).",
  "Choose an .ics file or paste the calendar text.":
    "Choisissez un fichier .ics ou collez le texte du calendrier.",
  "Use either a file or pasted text, not both.":
    "Utilisez soit un fichier, soit du texte collé, pas les deux.",
  "Only .ics calendar files are accepted. Export your events as an iCalendar (.ics) file.":
    "Seuls les fichiers de calendrier .ics sont acceptés. Exportez vos événements sous forme de fichier iCalendar (.ics).",
  "That calendar is larger than 1 MB. Export a shorter date range and try again.":
    "Ce calendrier dépasse 1 Mo. Exportez une période plus courte et réessayez.",
  "That file is not UTF-8 text. Save the calendar as a UTF-8 .ics file and try again.":
    "Ce fichier n’est pas du texte UTF-8. Enregistrez le calendrier sous forme de fichier .ics en UTF-8 et réessayez.",
  "The calendar is empty.": "Le calendrier est vide.",
  "That does not look like a calendar (.ics) file.":
    "Cela ne ressemble pas à un fichier de calendrier (.ics).",
  "The calendar holds no events.": "Le calendrier ne contient aucun événement.",
  "That calendar has more than 200 events. Export a shorter date range.":
    "Ce calendrier contient plus de 200 événements. Exportez une période plus courte.",
  "Tick at least one event to import.": "Cochez au moins un événement à importer.",
  "Some of the ticked events were not found in the calendar. Preview the file again.":
    "Certains des événements cochés n’ont pas été trouvés dans le calendrier. Prévisualisez de nouveau le fichier.",

  // Skipped events: one whole sentence each, with the event title or "An event"
  '"{title}" has no usable identifier.': "« {title} » n’a pas d’identifiant utilisable.",
  '"{title}" has no start time.': "« {title} » n’a pas d’heure de début.",
  '"{title}" has a start time that could not be read.':
    "« {title} » a une heure de début illisible.",
  '"{title}" has an end time that could not be read.': "« {title} » a une heure de fin illisible.",
  '"{title}" uses a time zone that could not be identified.':
    "« {title} » utilise un fuseau horaire qui n’a pas pu être identifié.",
  '"{title}" ends before it starts.': "« {title} » se termine avant de commencer.",
  '"{title}" has details that cannot be imported (such as a very long title or too many attendees).':
    "« {title} » contient des informations qui ne peuvent pas être importées (par exemple un titre très long ou trop de participants).",
  '"{title}" appears more than once in the file; the newest copy is used.':
    "« {title} » apparaît plusieurs fois dans le fichier ; la copie la plus récente est utilisée.",
  "An event has no usable identifier.": "Un événement n’a pas d’identifiant utilisable.",
  "An event has no start time.": "Un événement n’a pas d’heure de début.",
  "An event has a start time that could not be read.":
    "Un événement a une heure de début illisible.",
  "An event has an end time that could not be read.": "Un événement a une heure de fin illisible.",
  "An event uses a time zone that could not be identified.":
    "Un événement utilise un fuseau horaire qui n’a pas pu être identifié.",
  "An event ends before it starts.": "Un événement se termine avant de commencer.",
  "An event has details that cannot be imported (such as a very long title or too many attendees).":
    "Un événement contient des informations qui ne peuvent pas être importées (par exemple un titre très long ou trop de participants).",
  "An event appears more than once in the file; the newest copy is used.":
    "Un événement apparaît plusieurs fois dans le fichier ; la copie la plus récente est utilisée.",

  // src/app/meetings/messages.ts: notices and problems after a redirect to the inbox
  "Calendar import finished.": "Import du calendrier terminé.",
  "Your calendar has no upcoming events to import.":
    "Votre calendrier n’a aucun événement à venir à importer.",
  "Imported {n} new meeting.": "{n} nouvelle réunion importée.",
  "Imported {n} new meetings.": "{n} nouvelles réunions importées.",
  "Calendar file import finished.": "Import du fichier de calendrier terminé.",
  "Imported {n} new meeting from the calendar file.":
    "{n} nouvelle réunion importée depuis le fichier de calendrier.",
  "Imported {n} new meetings from the calendar file.":
    "{n} nouvelles réunions importées depuis le fichier de calendrier.",
  "{n} event was already in your list.": "{n} événement figurait déjà dans votre liste.",
  "{n} events were already in your list.": "{n} événements figuraient déjà dans votre liste.",
  "Note created. It appears under Upcoming.": "Note créée. Elle apparaît sous « À venir ».",
  "Your calendar could not be reached. Nothing was changed and your notes are safe. Try again in a moment, or create a note manually.":
    "Votre calendrier n’a pas pu être contacté. Rien n’a été modifié et vos notes sont en sécurité. Réessayez dans un instant, ou créez une note manuellement.",
  "The calendar service asked us to slow down. Wait a minute and try again.":
    "Le service de calendrier nous a demandé de ralentir. Patientez une minute et réessayez.",
  "Your calendar is not connected, so events cannot be imported. You can still create a note manually.":
    "Votre calendrier n’est pas connecté : les événements ne peuvent pas être importés. Vous pouvez toujours créer une note manuellement.",
};

export const sameInFrench: Record<string, string> = {
  Date: "Same word in French",
  "{when} ({n} min)": "min is the same abbreviation in French",
};
