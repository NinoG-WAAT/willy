import { formatInstant } from "../components/format-instant";
import {
  cardProgress,
  deletionRowProgress,
  parseDeletionsPayload,
  parseProcessingPayload,
  processingProgress,
  regenerationProgress,
  stoppedMessage,
  type ProgressView,
} from "../domain/progress/text";
import { handoffProgress, isTypingTarget, type HandoffView } from "../domain/progress/handoff";
import {
  decideNow,
  scheduleAutoOpen,
  type AutoOpenDeps,
  type AutoOpenState,
} from "./progress/auto-open";
import { createPoller, type PollReply } from "./progress/poller";
import { syncStage } from "./progress/stage-sync";

// Progressive enhancement for job progress. The pages already show the current state and a
// "Check again" link, so they are correct without this file. It polls the owner-scoped status
// endpoints and moves the new words into elements marked `data-progress`; the regions that carry
// the marker are `role="status"` live regions (or point at one with `data-announce-to`), so a
// screen reader hears the change. The wording comes from src/domain/progress/text.ts, the same
// functions the server uses, so a live update and a reload agree.

/** Home can list many meetings in processing; only the first few are watched. */
const MAX_WATCHERS = 3;

async function fetchJson(url: string): Promise<PollReply> {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const retryAfter = Number(response.headers.get("Retry-After"));
  let body: unknown = null;
  if (response.status === 200) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  return {
    status: response.status,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    body,
  };
}

/** A field inside the element, or one elsewhere on the page that names the element with `data-progress-for`. */
function fieldNode(scope: Element, name: string, regionId: string): HTMLElement | null {
  const inside = scope.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (inside || regionId === "") return inside;
  return document.querySelector<HTMLElement>(
    `[data-progress-for="${CSS.escape(regionId)}"][data-field="${name}"]`,
  );
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
  // Optional lines (an outcome, a next attempt) are hidden while empty.
  if (node.hasAttribute("data-optional")) node.hidden = text === "";
}

function writeFields(scope: Element, regionId: string, fields: Record<string, string>): void {
  for (const [name, text] of Object.entries(fields)) {
    const node = fieldNode(scope, name, regionId);
    if (node) setText(node, text);
  }
}

function announceTo(el: HTMLElement, text: string | null): void {
  const target = el.dataset["announceTo"];
  if (text === null || !target) return;
  const region = document.getElementById(target);
  if (region) region.textContent = text;
}

type Render = (el: HTMLElement, body: unknown) => { settled: boolean } | null;

function show(el: HTMLElement, view: ProgressView): { settled: boolean } {
  writeFields(el, el.id, view.fields);
  announceTo(el, view.announce);
  return { settled: view.settled };
}

function readAutoOpenState(): AutoOpenState {
  const focused = document.activeElement;
  const typingTarget =
    focused instanceof HTMLElement
      ? {
          tagName: focused.tagName,
          type: focused instanceof HTMLInputElement ? focused.type : "",
          isContentEditable: focused.isContentEditable,
        }
      : null;
  return {
    focusInTextField: isTypingTarget(typingTarget),
    // Set by the notes autosave while the textarea holds text the server may not have.
    unsavedNotes: document.getElementById("rough-notes")?.dataset["unsaved"] === "1",
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

/** The hand-off block of the live note after Stop (issue #66). */
function renderHandoff(el: HTMLElement, body: unknown): { settled: boolean } | null {
  const payload = parseProcessingPayload(body);
  if (!payload) return null;
  syncStage(payload.meetingStatus);
  const link = el.querySelector<HTMLAnchorElement>('a[data-field="link"]');
  const deps: AutoOpenDeps = {
    readState: readAutoOpenState,
    setTimer: (run, ms) => window.setTimeout(run, ms),
    // The address was rendered by the server from this page's meeting id; a status answer
    // can never choose where the page goes.
    navigate: () => {
      const href = link?.getAttribute("href");
      if (href) window.location.assign(href);
    },
    announce: (text) => {
      writeFields(el, el.id, { announce: text });
    },
  };

  let view: HandoffView = handoffProgress(payload);
  const decision = decideNow(deps, view.stage);
  if (decision.open) view = handoffProgress(payload, { autoOpening: true });

  const wasHidden = link?.hidden ?? false;
  writeFields(el, el.id, view.fields);
  const bar = el.querySelector<HTMLProgressElement>("progress[data-bar]");
  if (bar) {
    bar.hidden = view.bar === null;
    if (view.bar) {
      bar.max = view.bar.max;
      bar.value = view.bar.value;
    }
  }
  if (view.stage === "ready") {
    // For someone who switched windows while waiting.
    if (!document.title.startsWith("Draft ready"))
      document.title = `Draft ready: ${document.title}`;
    const animate = decision.open ? decision.animate : !readAutoOpenState().reducedMotion;
    if (link && wasHidden && animate) link.classList.add("handoff-reveal");
  }
  scheduleAutoOpen(deps, decision);
  return { settled: view.settled };
}

const renderers: Record<string, Render> = {
  handoff: renderHandoff,
  processing: (el, body) => {
    const payload = parseProcessingPayload(body);
    // Only the live note has a link to the review (its href is in the page, built from the
    // meeting id it renders); the review page itself does not.
    const withLink = fieldNode(el, "link", el.id) !== null;
    if (!payload) return null;
    syncStage(payload.meetingStatus);
    return show(el, processingProgress(payload, withLink));
  },
  regeneration: (el, body) => {
    const payload = parseProcessingPayload(body);
    return payload ? show(el, regenerationProgress(payload, el.dataset["sectionId"] ?? "")) : null;
  },
  card: (el, body) => {
    const payload = parseProcessingPayload(body);
    return payload
      ? show(
          el,
          cardProgress(payload, el.dataset["title"] ?? "A meeting", el.dataset["meetingId"] ?? ""),
        )
      : null;
  },
  deletions: (el, body) => {
    const rows = parseDeletionsPayload(body);
    if (!rows) return null;
    let settled = true;
    const changed: string[] = [];
    for (const item of el.querySelectorAll<HTMLElement>("[data-deletion-id]")) {
      const id = item.dataset["deletionId"] ?? "";
      const row = rows.find((candidate) => candidate.meetingId === id);
      if (!row) continue; // Older than the list: nothing new to say about it.
      const view = deletionRowProgress(row);
      const label = item.querySelector<HTMLElement>('[data-field="label"]');
      if (label && label.textContent !== view.label) {
        changed.push(`Deletion with reference ${id}: ${view.label}. ${view.detail}`);
      }
      writeFields(item, "", {
        label: view.label,
        detail: view.detail,
        next:
          row.status === "retrying" && row.nextRunAt !== null
            ? `Next attempt: ${formatInstant(row.nextRunAt)}`
            : "",
      });
      const retry = item.querySelector<HTMLElement>('[data-field="retry"]');
      if (retry) retry.hidden = !view.canRetry;
      if (!view.settled) settled = false;
    }
    for (const note of el.querySelectorAll<HTMLElement>("[data-while-running]")) {
      note.hidden = settled;
    }
    announceTo(el, changed.length > 0 ? changed.join(" ") : null);
    return { settled };
  },
};

function watch(el: HTMLElement): void {
  const render = renderers[el.dataset["progress"] ?? ""];
  const url = el.dataset["progressUrl"];
  if (!render || !url) return;
  const poller = createPoller({
    url,
    fetchJson,
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (handle) => {
      window.clearTimeout(handle as number);
    },
    now: () => Date.now(),
    random: () => Math.random(),
    isHidden: () => document.hidden,
    onVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
    },
    render: (body) => render(el, body),
    onStop: (reason) => {
      if (reason === "settled") return;
      const outcome = fieldNode(el, "outcome", el.id);
      if (outcome) setText(outcome, stoppedMessage(reason));
    },
  });
  poller.start();
}

for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-progress]")).slice(
  0,
  MAX_WATCHERS,
)) {
  watch(el);
}
