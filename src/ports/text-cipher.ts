export interface SealedText {
  /** Opaque, self-describing value to store in a TEXT column. */
  ciphertext: string;
  /** Id of the key that wrapped this record's key; stored beside the ciphertext for rotation. */
  keyId: string;
}

/**
 * Encrypts short texts (transcript segments, provider tokens) at rest.
 * `context` binds the ciphertext to its row (for example `segment:<id>`): decrypting it under
 * any other context fails, so values cannot be moved between rows or owners.
 */
export interface TextCipher {
  encrypt(plaintext: string, context: string): Promise<SealedText>;
  decrypt(ciphertext: string, context: string): Promise<string>;
}
