export interface SealedBytes {
  bytes: Uint8Array<ArrayBuffer>;
  /** Key that sealed these bytes; stored beside the object's metadata for rotation. */
  keyId: string;
}

/**
 * Authenticated encryption of binary objects (audio chunks). `context` (the object key) is
 * authenticated: opening under any other context throws, so objects cannot be moved between
 * owners or meetings. `open` throws on tampering, wrong context or an unknown key.
 */
export interface BytesCipher {
  seal(plain: Uint8Array<ArrayBuffer>, context: string): Promise<SealedBytes>;
  open(sealed: Uint8Array<ArrayBuffer>, context: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Key id recorded in the header (unauthenticated hint; only `open` proves anything). */
  keyIdOf(sealed: Uint8Array<ArrayBuffer>): string | null;
}
