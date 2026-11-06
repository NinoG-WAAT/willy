import "./i18n";
import { t, tn } from "./i18n";

/**
 * Review screen enhancement. Without JavaScript a source link reloads the page with the cited
 * lines marked by the server (and the transcript panel opened); with it the marks move in place,
 * so unsaved edits in the summary are not lost, and the result is announced to screen readers.
 * The transcript panel and the publish form are native disclosures: here they also open when a
 * link points at them, which a closed <details> does not do by itself.
 */
const announce = document.getElementById("source-status");

// A section opened for editing is one textarea that grows with its text, so the owner sees the
// whole body without a scrollbar. Without JavaScript it keeps its few rows and scrolls.
function grow(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  area.style.height = `${String(area.scrollHeight + area.offsetHeight - area.clientHeight)}px`;
}
for (const area of document.querySelectorAll<HTMLTextAreaElement>("textarea[data-autogrow]")) {
  grow(area);
  area.addEventListener("input", () => {
    grow(area);
  });
  if (area.hasAttribute("autofocus")) {
    // After the load: the browser moves focus to the "#section-…" target when the page has
    // finished, which would otherwise undo this. The cursor goes to the end, where the owner
    // most likely continues.
    const focusEnd = (): void => {
      area.focus({ preventScroll: true });
      area.setSelectionRange(area.value.length, area.value.length);
    };
    if (document.readyState === "complete") focusEnd();
    else window.addEventListener("load", focusEnd, { once: true });
  }
}

function open(selector: string): HTMLDetailsElement | null {
  const details = document.querySelector<HTMLDetailsElement>(selector);
  if (details) details.open = true;
  return details;
}

/** A link or address that targets something inside a closed disclosure opens it first. */
function openFor(hash: string): void {
  if (hash === "#transcript-panel" || hash.startsWith("#seg-")) open("#transcript-panel");
  if (hash === "#publish") open("#publish details");
}

openFor(window.location.hash);
window.addEventListener("hashchange", () => {
  openFor(window.location.hash);
});

document.addEventListener("click", (event) => {
  const anchor = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const hash = anchor.getAttribute("href") ?? "";
  if (hash !== "#publish" && hash !== "#transcript-panel") return;
  openFor(hash);
  // The bar is already on screen: put the cursor where the owner will act. A published note has
  // no form, so its link keeps scrolling to the section as a plain anchor does.
  const folder = hash === "#publish" ? document.getElementById("publish-folder") : null;
  if (folder) {
    event.preventDefault();
    folder.focus();
  }
});

document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("a[data-source-from]") : null;
  if (!(link instanceof HTMLAnchorElement)) return;
  const from = Number(link.dataset["sourceFrom"]);
  const to = Number(link.dataset["sourceTo"]);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return;
  event.preventDefault();
  open("#transcript-panel");

  let first: HTMLElement | null = null;
  let marked = 0;
  for (const line of document.querySelectorAll<HTMLElement>("li[data-pos]")) {
    const position = Number(line.dataset["pos"]);
    const on = position >= from && position <= to;
    line.classList.toggle("is-source", on);
    line.querySelector(".seg-flag")?.toggleAttribute("hidden", !on);
    if (on) {
      marked += 1;
      first ??= line;
    }
  }
  if (first) {
    first.scrollIntoView({ block: "center" });
    first.focus({ preventScroll: true });
  }
  if (announce) {
    announce.textContent =
      marked === 0
        ? t("The cited transcript lines are not available.")
        : tn(
            "{n} cited transcript line is marked.",
            "{n} cited transcript lines are marked.",
            marked,
          );
  }
});
// Assigning transcript lines to a speaker: shift-click ticks everything between two lines, and a
// count is announced. Without JavaScript the checkboxes and the form work as they are.
const picks = [...document.querySelectorAll<HTMLInputElement>("input.seg-pick")];
const pickStatus = document.getElementById("assign-status");
let lastPick: HTMLInputElement | null = null;

function announcePicks(): void {
  if (!pickStatus) return;
  const n = picks.filter((p) => p.checked).length;
  pickStatus.textContent = n === 0 ? "" : tn("{n} line selected.", "{n} lines selected.", n);
}

for (const pick of picks) {
  pick.addEventListener("click", (event) => {
    if (event.shiftKey && lastPick && lastPick !== pick) {
      const from = picks.indexOf(lastPick);
      const to = picks.indexOf(pick);
      for (const between of picks.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        between.checked = pick.checked;
      }
    }
    lastPick = pick;
    announcePicks();
  });
}
announcePicks();
export {};
