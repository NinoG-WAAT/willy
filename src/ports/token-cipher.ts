import type { Result } from "../domain/platform/result";

export type CipherError = "malformed" | "unknown_key" | "tampered";

/**
 * Authenticated encryption for long-lived secrets at rest. `context` (for example
 * `calendar:<ownerId>`) is bound into the ciphertext so a sealed value cannot be replayed
 * under another owner or purpose. The sealed string embeds the key id for rotation.
 */
export interface TokenCipher {
  seal(plaintext: string, context: string): Promise<string>;
  open(sealed: string, context: string): Promise<Result<string, CipherError>>;
}
