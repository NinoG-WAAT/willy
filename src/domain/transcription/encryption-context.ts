/** Binds encrypted segment text to its row so ciphertext cannot be swapped between segments. */
export function segmentTextContext(segmentId: string): string {
  return `segment:${segmentId}`;
}
