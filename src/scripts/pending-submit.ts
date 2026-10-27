// Progressive enhancement: forms that carry data-pending-text show a pending state while the
// browser submits them. Without JavaScript the form still works; it just gives no interim text.
for (const form of document.querySelectorAll<HTMLFormElement>("form[data-pending-text]")) {
  const button = form.querySelector<HTMLButtonElement>("button[type='submit']");
  button?.addEventListener("click", (event) => {
    // A second click while the first submission is in flight must not submit again.
    if (button.getAttribute("aria-disabled") === "true") event.preventDefault();
  });
  form.addEventListener("submit", () => {
    const text = form.dataset["pendingText"] ?? "Working…";
    if (button) {
      button.setAttribute("aria-disabled", "true");
      button.textContent = text;
    }
    const status = document.getElementById("pending-status");
    if (status) status.textContent = text;
  });
}
