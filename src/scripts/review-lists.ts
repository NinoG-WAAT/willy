/**
 * Review outline enhancement (decisions and action items). Without JavaScript everything is a
 * plain form: the done checkbox has its own Save button, Edit and Cancel are links. With it a tick
 * submits straight away and the item that was just opened (or rejected) gets the focus: the
 * browser does not honour `autofocus` when the URL has a fragment.
 */
for (const form of document.querySelectorAll<HTMLFormElement>("form.rl-done")) {
  form.dataset["auto"] = "";
}

document.addEventListener("change", (event) => {
  const box = event.target;
  if (!(box instanceof HTMLInputElement) || !box.classList.contains("rl-done-box")) return;
  box.form?.requestSubmit();
});

function focusOpenedItem(): void {
  const editing = document.querySelector(".rl-item.is-editing");
  const target =
    editing?.querySelector<HTMLElement>("[aria-invalid=true]") ??
    editing?.querySelector<HTMLElement>("[autofocus]") ??
    document.querySelector<HTMLElement>(".rl-add[open] [aria-invalid=true]");
  target?.focus();
}

// The jump to the URL fragment (the item's anchor) clears focus once the page has loaded, so the
// focus moves after it.
if (document.readyState === "complete") focusOpenedItem();
else window.addEventListener("load", focusOpenedItem);

export {};
