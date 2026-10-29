// Progressive enhancement for the ICS import form: default the "time zone for events without one"
// to the browser's. Without JavaScript the select simply starts at UTC and the owner picks.
const zone = document.querySelector<HTMLSelectElement>("select[data-browser-zone]");
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (zone && zone.value === "UTC" && [...zone.options].some((o) => o.value === browserZone)) {
  zone.value = browserZone;
}

// A module, so its top-level names do not collide with the other page scripts.
export {};
