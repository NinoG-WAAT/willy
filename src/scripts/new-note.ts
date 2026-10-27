// Progressive enhancement for the new-note form: default the date, time and time zone to the
// browser's. Values the owner already typed or submitted are never overwritten.
const zone = document.querySelector<HTMLSelectElement>("select[data-browser-zone]");
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (zone && zone.value === "UTC" && [...zone.options].some((o) => o.value === browserZone)) {
  zone.value = browserZone;
}

const pad = (n: number) => String(n).padStart(2, "0");
const date = document.querySelector<HTMLInputElement>("#date");
const time = document.querySelector<HTMLInputElement>("#time");
const next = new Date(Date.now() + 60 * 60 * 1000);
if (date && date.value === "") {
  date.value = `${String(next.getFullYear())}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}
if (time && time.value === "") time.value = `${pad(next.getHours())}:00`;
