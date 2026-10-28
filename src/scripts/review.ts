/**
 * Review screen enhancement. Without JavaScript a source link reloads the page with the cited
 * lines marked by the server; with it the marks move in place, so unsaved edits in the summary
 * are not lost, and the result is announced to screen readers.
 */
const announce = document.getElementById("source-status");

document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("a[data-source-from]") : null;
  if (!(link instanceof HTMLAnchorElement)) return;
  const from = Number(link.dataset["sourceFrom"]);
  const to = Number(link.dataset["sourceTo"]);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return;
  event.preventDefault();

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
        ? "The cited transcript lines are not available."
        : `${String(marked)} cited transcript ${marked === 1 ? "line is" : "lines are"} marked.`;
  }
});
export {};
