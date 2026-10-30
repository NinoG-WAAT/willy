const DEBOUNCE_MS = 1_000;
const RETRY_BASE_MS = 3_000;
const RETRY_CAP_MS = 30_000;

const clock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Autosaves the rough notes while the owner types. The plain form (Save notes button) keeps
 * working without this. Unsaved text is also kept in this browser's localStorage so a refresh,
 * crash or lost connection never loses it; it is removed as soon as the server has it.
 */
export function setupNotesAutosave(root: HTMLElement): void {
  const textarea = document.querySelector<HTMLTextAreaElement>("#rough-notes");
  const status = document.querySelector<HTMLElement>("#notes-status");
  const meetingId = root.dataset["meetingId"];
  const csrf = root.dataset["csrf"] ?? "";
  if (!textarea || !status || !meetingId || root.dataset["notesEditable"] !== "1") return;

  const draftKey = `willy:notes-draft:${meetingId}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving = false;
  let failures = 0;

  const readDraft = (): string | null => {
    try {
      return localStorage.getItem(draftKey);
    } catch {
      return null;
    }
  };
  const writeDraft = (value: string | null): void => {
    try {
      if (value === null) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, value);
    } catch {
      // Storage can be unavailable (private mode); the server copy is still saved.
    }
  };
  // The hand-off after Stop reads this to know the notes are not safely on the server yet, so it
  // does not navigate away from words that only this page holds.
  const markUnsaved = (unsaved: boolean): void => {
    if (unsaved) textarea.dataset["unsaved"] = "1";
    else delete textarea.dataset["unsaved"];
  };
  const schedule = (ms: number): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void save(), ms);
  };

  const save = async (): Promise<void> => {
    if (saving) return;
    saving = true;
    const value = textarea.value;
    try {
      const response = await fetch(`/api/meetings/${meetingId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ roughNotes: value }),
        credentials: "same-origin",
      });
      if (response.ok) {
        failures = 0;
        if (textarea.value === value) {
          writeDraft(null);
          markUnsaved(false);
          status.textContent = `Saved at ${clock()}.`;
        } else {
          schedule(DEBOUNCE_MS);
        }
      } else if (response.status === 422 || response.status === 413) {
        status.textContent = "Not saved: these notes are too long. Shorten them to save.";
      } else if (response.status === 404 || response.status === 401 || response.status === 403) {
        status.textContent =
          "Not saved: sign in again or reload the page. Your text is kept in this browser.";
      } else {
        throw new Error("transient");
      }
    } catch {
      failures += 1;
      status.textContent = "Not saved yet. Retrying. Your text is kept in this browser.";
      schedule(Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (failures - 1)));
    } finally {
      saving = false;
    }
  };

  const draft = readDraft();
  if (draft !== null && draft !== textarea.value) {
    textarea.value = draft;
    markUnsaved(true);
    status.textContent = "Restored notes you typed but had not saved. Saving…";
    schedule(0);
  }

  textarea.addEventListener("input", () => {
    writeDraft(textarea.value);
    markUnsaved(true);
    status.textContent = "Saving…";
    schedule(DEBOUNCE_MS);
  });
}
