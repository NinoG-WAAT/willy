/**
 * Input level in [0, 1] from AnalyserNode time-domain bytes (128 is silence, 0 and 255 are full
 * scale): the root mean square of the signal's deviation from the midpoint.
 */
export function inputLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}
