import { formatElapsed } from "./capture/elapsed";
import { inputLevel } from "./capture/level";
import { setupNotesAutosave } from "./capture/notes-autosave";
import {
  startSegmentedRecorder,
  supportsRecording,
  type SegmentedRecorder,
} from "./capture/recorder";
import { createUploadQueue } from "./capture/upload-queue";

// Progressive enhancement for the live note. Everything that matters is also a plain form:
// consent, start, pause, stop and notes work (and are enforced) on the server without this file.
// This adds the parts that need the browser: microphone capture, chunk upload with retry,
// the timer, the input level, autosave, and honest status when something goes wrong.

const root = document.getElementById("live-note");
if (root) setup(root);

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function control<T extends HTMLElement>(id: string, type: new () => T): T | null {
  const element = document.getElementById(id);
  return element instanceof type ? element : null;
}

function setup(root: HTMLElement): void {
  const meetingId = root.dataset["meetingId"] ?? "";
  const csrf = root.dataset["csrf"] ?? "";
  const status = root.dataset["status"] ?? "";
  const segmentMs = Number(root.dataset["segmentMs"] ?? "10000");
  const recordedMs = Number(root.dataset["recordedMs"] ?? "0");
  let nextSeq = Number(root.dataset["nextSeq"] ?? "0");
  // This tab starts recording only if the owner started or resumed capture from this tab. Another
  // device or tab that merely opens the page must not silently begin capturing.
  const recorderFlag = `willy:recorder:${meetingId}`;
  const flag = {
    get: () => {
      try {
        return sessionStorage.getItem(recorderFlag) === "1";
      } catch {
        return false;
      }
    },
    set: () => {
      try {
        sessionStorage.setItem(recorderFlag, "1");
      } catch {
        // Without sessionStorage the owner can still use "Record from this browser".
      }
    },
    clear: () => {
      try {
        sessionStorage.removeItem(recorderFlag);
      } catch {
        // Nothing to clear.
      }
    },
  };

  setupNotesAutosave(root);

  const banner = byId("rec-banner");
  const detailText = byId("rec-detail");
  const timerText = byId("rec-timer");
  const levelBox = byId("level");
  const levelMeter = control("level-meter", HTMLMeterElement);
  const levelText = byId("level-text");
  const uploadStatus = byId("upload-status");
  const problemBox = byId("capture-problem");
  const problemText = byId("capture-problem-text");
  const retryMic = control("retry-mic", HTMLButtonElement);
  const retryUpload = control("retry-upload", HTMLButtonElement);
  const stopAnyway = control("stop-anyway", HTMLButtonElement);

  const setDetail = (text: string): void => {
    if (detailText) detailText.textContent = text;
  };
  const showProblem = (
    text: string,
    buttons: { mic?: boolean; upload?: boolean; stopAnyway?: boolean },
  ): void => {
    if (!problemBox || !problemText) return;
    problemText.textContent = text;
    if (retryMic) retryMic.hidden = !buttons.mic;
    if (retryUpload) retryUpload.hidden = !buttons.upload;
    if (stopAnyway) stopAnyway.hidden = !buttons.stopAnyway;
    problemBox.hidden = false;
  };
  const clearProblem = (): void => {
    if (problemBox) problemBox.hidden = true;
  };

  // ---------------------------------------------------------------- consent and start
  const startForm = control("start-form", HTMLFormElement);
  const consent = control("consent", HTMLInputElement);
  const startButton = control("start-button", HTMLButtonElement);
  if (startForm && startButton) {
    if (!supportsRecording()) {
      startButton.disabled = true;
      const note = document.createElement("p");
      note.className = "alert";
      note.textContent =
        "This browser cannot record audio, so capture cannot start here. You can still take notes, or open this note in a current browser.";
      startForm.append(note);
    } else if (consent) {
      // Hardening only: the server refuses to start without the tick regardless of this button.
      const sync = (): void => {
        startButton.disabled = !consent.checked;
      };
      consent.addEventListener("change", sync);
      sync();
    }
    startForm.addEventListener("submit", () => {
      flag.set();
    });
  }

  // ---------------------------------------------------------------- upload queue
  const queue = createUploadQueue({
    upload: async (url, body, headers) => {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        credentials: "same-origin",
      });
      const retryAfter = Number(response.headers.get("Retry-After"));
      // 409 has two meanings (capture ended, or the sequence number holds other audio): the code
      // in the body tells them apart.
      let error: string | null = null;
      if (response.status === 409) {
        const body: unknown = await response.json().catch(() => null);
        const code =
          typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
        error = typeof code === "string" ? code : null;
      }
      return {
        status: response.status,
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
        error,
      };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: () => Math.random(),
    endpoint: (seq, durationMs) =>
      `/api/meetings/${meetingId}/chunks?seq=${String(seq)}&durationMs=${String(durationMs)}`,
    headers: { "X-CSRF-Token": csrf },
    baseMs: 500,
    capMs: 8_000,
    maxAttempts: 6,
    onEvent: (event) => {
      renderUploadStatus();
      if (event.kind === "renumbered") {
        // Later segments must not reuse a number the queue has just moved past.
        nextSeq = Math.max(nextSeq, event.to + 1);
      } else if (event.kind === "stalled") {
        showProblem(
          "Audio is waiting to upload. Check your connection. Your notes are safe and nothing recorded so far has been lost.",
          { upload: true },
        );
      } else if (event.kind === "rejected") {
        showProblem(
          "The server did not accept part of the audio, so that part is missing from the transcript. Recording continues.",
          {},
        );
      } else if (event.kind === "closed") {
        void closeRecording();
        setDetail("Capture has ended on the server. Reload the page to see the current state.");
        showProblem(
          "This note is no longer capturing, so no more audio is accepted. Reload the page.",
          {},
        );
      } else if (event.kind === "uploaded" && queue.state().stalled === 0) {
        clearProblem();
      }
    },
  });

  function renderUploadStatus(): void {
    if (!uploadStatus) return;
    const { pending, stalled, uploaded } = queue.state();
    if (stalled > 0)
      uploadStatus.textContent = `Upload problem: ${String(stalled)} audio part(s) are waiting.`;
    else if (pending > 0)
      uploadStatus.textContent = `Uploading audio… ${String(pending)} part(s) waiting.`;
    else if (uploaded > 0) uploadStatus.textContent = "All recorded audio is uploaded.";
  }

  // ---------------------------------------------------------------- recording
  let stream: MediaStream | null = null;
  let recorder: SegmentedRecorder | null = null;
  let audioContext: AudioContext | null = null;
  let timerHandle: ReturnType<typeof setInterval> | undefined;
  let levelHandle: number | undefined;
  let runStartedAt = 0;

  function micMessage(error: unknown): string {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again. Your notes are not affected.";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "No microphone was found. Connect one, then try again.";
    }
    return "The microphone could not be started. Make sure no other app is using it, then try again.";
  }

  async function startRecording(): Promise<void> {
    clearProblem();
    setDetail("Starting the microphone…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      setDetail("Not recording in this browser.");
      showProblem(micMessage(error), { mic: true, stopAnyway: false });
      if (retryMic) retryMic.textContent = "Try the microphone again";
      return;
    }
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (recorder) {
          void closeRecording();
          setDetail("Not recording in this browser: the microphone was disconnected.");
          showProblem("The microphone stopped. Reconnect it, then try again.", { mic: true });
        }
      });
    });
    recorder = startSegmentedRecorder(stream, segmentMs, (blob, durationMs) => {
      queue.add(nextSeq, blob, durationMs);
      nextSeq += 1;
      renderUploadStatus();
    });
    runStartedAt = performance.now();
    setDetail("The microphone is on in this browser.");
    startTimer();
    startLevelMeter(stream);
  }

  function startTimer(): void {
    const tick = (): void => {
      if (timerText)
        timerText.textContent = formatElapsed(recordedMs + (performance.now() - runStartedAt));
    };
    tick();
    timerHandle = setInterval(tick, 250);
  }

  function startLevelMeter(source: MediaStream): void {
    if (!levelBox || !levelMeter || typeof AudioContext === "undefined") return;
    audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(source).connect(analyser);
    const resume = (): void => {
      void audioContext?.resume();
    };
    resume();
    document.addEventListener("pointerdown", resume, { once: true });
    levelBox.hidden = false;
    const samples = new Uint8Array(analyser.fftSize);
    let quietSince = performance.now();
    let lastMessage = "";
    const frame = (): void => {
      analyser.getByteTimeDomainData(samples);
      const level = inputLevel(samples);
      levelMeter.value = Math.min(1, level * 3);
      const now = performance.now();
      if (level > 0.01) quietSince = now;
      const message =
        audioContext?.state !== "running"
          ? ""
          : now - quietSince > 5_000
            ? "No sound detected. Check that the right microphone is selected."
            : "The microphone is picking up sound.";
      if (message !== lastMessage && levelText) {
        levelText.textContent = message;
        lastMessage = message;
      }
      levelHandle = requestAnimationFrame(frame);
    };
    levelHandle = requestAnimationFrame(frame);
  }

  /** Stops the recorder (its last segment is queued), the meters and the microphone. */
  async function closeRecording(): Promise<void> {
    const active = recorder;
    recorder = null;
    clearInterval(timerHandle);
    if (levelHandle !== undefined) cancelAnimationFrame(levelHandle);
    await active?.stop();
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    if (audioContext) await audioContext.close().catch(() => undefined);
    audioContext = null;
    if (levelBox) levelBox.hidden = true;
  }

  async function waitForUploads(maxMs: number): Promise<void> {
    await Promise.race([queue.idle(), new Promise((resolve) => setTimeout(resolve, maxMs))]);
  }

  // ---------------------------------------------------------------- capture buttons
  let pendingForm: HTMLFormElement | null = null;

  const submitConfirmed = (form: HTMLFormElement): void => {
    form.dataset["confirmed"] = "1";
    form.submit();
  };

  for (const form of document.querySelectorAll<HTMLFormElement>("form[data-capture-action]")) {
    form.addEventListener("submit", (event) => {
      if (form.dataset["confirmed"] === "1") return;
      const action = form.dataset["captureAction"];
      if (action === "resume") {
        flag.set();
        return;
      }
      if (!recorder && queue.state().pending === 0 && queue.state().stalled === 0) {
        flag.clear();
        return;
      }
      // Pause and stop: finish the current segment and get the audio to the server first.
      event.preventDefault();
      void (async () => {
        await closeRecording();
        // Chunks that already ran out of retries will not clear by waiting: do not make the owner wait.
        await waitForUploads(queue.state().stalled > 0 ? 1_500 : 20_000);
        const { pending, stalled } = queue.state();
        if (pending > 0 || stalled > 0) {
          pendingForm = form;
          renderUploadStatus();
          showProblem(
            `${String(pending + stalled)} audio part(s) are not uploaded yet. Retry the upload before ${action === "stop" ? "stopping" : "pausing"}, or continue anyway and lose that audio.`,
            { upload: true, stopAnyway: true },
          );
          if (stopAnyway)
            stopAnyway.textContent = action === "stop" ? "Stop anyway" : "Pause anyway";
          return;
        }
        flag.clear();
        submitConfirmed(form);
      })();
    });
  }

  retryMic?.addEventListener("click", () => {
    flag.set();
    void startRecording();
  });

  retryUpload?.addEventListener("click", () => {
    queue.retryStalled();
    void (async () => {
      await waitForUploads(20_000);
      renderUploadStatus();
      const { pending, stalled } = queue.state();
      if (pending === 0 && stalled === 0) {
        clearProblem();
        if (pendingForm) {
          flag.clear();
          submitConfirmed(pendingForm);
        }
      }
    })();
  });

  stopAnyway?.addEventListener("click", () => {
    if (pendingForm) {
      flag.clear();
      submitConfirmed(pendingForm);
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (recorder || queue.state().pending > 0 || queue.state().stalled > 0) {
      event.preventDefault();
    }
  });

  // ---------------------------------------------------------------- initial state
  if (status === "capturing" && banner) {
    if (!supportsRecording()) {
      setDetail("Not recording in this browser: it cannot record audio.");
      showProblem(
        "This browser cannot record audio. Open this note in a current browser to continue capturing, or stop capture.",
        {},
      );
    } else if (flag.get()) {
      void startRecording();
    } else {
      setDetail("Capture is running, but this browser is not recording.");
      showProblem(
        "This note is being captured on another device or tab, or recording stopped here after a reload. Record from this browser to continue.",
        { mic: true },
      );
      if (retryMic) retryMic.textContent = "Record from this browser";
    }
  }
}
