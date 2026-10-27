import type { BytesCipher, SealedBytes } from "../../ports/bytes-cipher";
import type { Keyring } from "./envelope-cipher";

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM for audio chunks. Layout: `[version][keyIdLength][keyId][nonce(12)][ciphertext+tag]`.
 * The nonce is random per object, and the header plus the caller's context (the object key) are
 * authenticated, so flipping any byte or moving an object to another key makes `open` throw.
 * Rotation: new objects use `activeKeyId`; older ones stay readable while their key id remains
 * in the keyring (see docs/DATA_MODEL.md).
 */
export function createChunkCipher(keyring: Keyring, activeKeyId: string): BytesCipher {
  if (!keyring.has(activeKeyId)) throw new Error("Active encryption key id is not in the keyring");
  const imported = new Map<string, Promise<CryptoKey>>();
  const keyFor = (id: string): Promise<CryptoKey> => {
    let key = imported.get(id);
    if (!key) {
      const raw = keyring.get(id);
      if (!raw) return Promise.reject(new Error(`Unknown encryption key id: ${id}`));
      key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
      imported.set(id, key);
    }
    return key;
  };

  const aad = (header: Uint8Array, context: string): Uint8Array<ArrayBuffer> => {
    const ctx = new TextEncoder().encode(context);
    const out = new Uint8Array(header.length + ctx.length);
    out.set(header, 0);
    out.set(ctx, header.length);
    return out;
  };

  return {
    async seal(plain, context): Promise<SealedBytes> {
      const keyIdBytes = new TextEncoder().encode(activeKeyId);
      const header = new Uint8Array(2 + keyIdBytes.length);
      header[0] = VERSION;
      header[1] = keyIdBytes.length;
      header.set(keyIdBytes, 2);
      const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
      const body = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce, additionalData: aad(header, context) },
          await keyFor(activeKeyId),
          plain,
        ),
      );
      const out = new Uint8Array(header.length + NONCE_BYTES + body.length);
      out.set(header, 0);
      out.set(nonce, header.length);
      out.set(body, header.length + NONCE_BYTES);
      return { bytes: out, keyId: activeKeyId };
    },

    async open(sealed, context) {
      const parsed = parse(sealed);
      if (!parsed) throw new Error("Malformed encrypted object");
      const plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: parsed.nonce,
          additionalData: aad(sealed.subarray(0, parsed.headerLength), context),
        },
        await keyFor(parsed.keyId),
        parsed.body,
      );
      return new Uint8Array(plain);
    },

    keyIdOf(sealed) {
      return parse(sealed)?.keyId ?? null;
    },
  };
}

function parse(sealed: Uint8Array<ArrayBuffer>): {
  keyId: string;
  headerLength: number;
  nonce: Uint8Array<ArrayBuffer>;
  body: Uint8Array<ArrayBuffer>;
} | null {
  if (sealed.length < 2 || sealed[0] !== VERSION) return null;
  const keyIdLength = sealed[1] ?? 0;
  const headerLength = 2 + keyIdLength;
  if (keyIdLength === 0 || sealed.length < headerLength + NONCE_BYTES + TAG_BYTES) return null;
  let keyId: string;
  try {
    keyId = new TextDecoder("utf-8", { fatal: true }).decode(sealed.subarray(2, headerLength));
  } catch {
    return null;
  }
  return {
    keyId,
    headerLength,
    nonce: sealed.slice(headerLength, headerLength + NONCE_BYTES),
    body: sealed.slice(headerLength + NONCE_BYTES),
  };
}
