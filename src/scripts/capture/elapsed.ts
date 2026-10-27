/** "HH:MM:SS" for the capture timer (hours may exceed two digits; never negative). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  return `${pad(hours)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
