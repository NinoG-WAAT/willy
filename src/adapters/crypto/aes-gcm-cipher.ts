import { err, ok } from "../../domain/platform/result";
import type { TokenCipher } from "../../ports/token-cipher";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(text, "base64"));

export interface AesGcmCipherConfig {
  /** keyId -> base64 of a 32-byte key. Keep old ids here so records sealed before a rotation still open. */
  keys: Record<string, string>;
  activeKeyId: string;
  /** Injected randomness (crypto.getRandomValues in production, anything in tests). */
  randomBytes: (length: number) => Uint8Array<ArrayBuffer>;
}

/** AES-256-GCM envelope: `<keyId>.<nonce b64>.<ciphertext+tag b64>`, context bound as AAD. */
export function createAesGcmCipher(config: AesGcmCipherConfig): TokenCipher {
  const raw = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [id, b64] of Object.entries(config.keys)) {
    const bytes = fromBase64(b64);
    if (bytes.length !== KEY_BYTES)
      throw new Error(`encryption key ${id} must be ${String(KEY_BYTES)} bytes`);
    raw.set(id, bytes);
  }
  if (!raw.has(config.activeKeyId)) throw new Error("active key id is not in the configured keys");

  const imported = new Map<string, Promise<CryptoKey>>();
  const keyFor = (id: string): Promise<CryptoKey> | null => {
    const bytes = raw.get(id);
    if (!bytes) return null;
    let key = imported.get(id);
    if (!key) {
      key = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
      imported.set(id, key);
    }
    return key;
  };
  const activeKey = keyFor(config.activeKeyId);
  if (!activeKey) throw new Error("active key id is not in the configured keys");

  return {
    async seal(plaintext, context) {
      const key = await activeKey;
      const nonce = config.randomBytes(NONCE_BYTES);
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(context) },
        key,
        encoder.encode(plaintext),
      );
      return `${config.activeKeyId}.${toBase64(nonce)}.${toBase64(new Uint8Array(ciphertext))}`;
    },
    async open(sealed, context) {
      const parts = sealed.split(".");
      if (parts.length !== 3) return err("malformed");
      const [keyId, nonceB64, ciphertextB64] = parts as [string, string, string];
      const key = keyFor(keyId);
      if (!key) return err("unknown_key");
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: fromBase64(nonceB64), additionalData: encoder.encode(context) },
          await key,
          fromBase64(ciphertextB64),
        );
        return ok(decoder.decode(plaintext));
      } catch {
        return err("tampered");
      }
    },
  };
}
