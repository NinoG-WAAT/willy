import type { SealedText, TextCipher } from "../../ports/text-cipher";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

export type Keyring = ReadonlyMap<string, Uint8Array<ArrayBuffer>>;

/** Parses `id:base64key,id2:base64key` (the ENCRYPTION_KEYS secret). Keys are 32 bytes. */
export function parseKeyring(spec: string): Keyring {
  const ring = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const entry of spec.split(",")) {
    const sep = entry.indexOf(":");
    const id = sep < 0 ? "" : entry.slice(0, sep).trim();
    const b64 = sep < 0 ? "" : entry.slice(sep + 1).trim();
    if (!KEY_ID.test(id)) throw new Error("Invalid encryption key id in keyring");
    if (ring.has(id)) throw new Error(`Duplicate encryption key id: ${id}`);
    const key = fromBase64(b64);
    if (key.length !== KEY_BYTES) throw new Error(`Encryption key ${id} must be 32 bytes`);
    ring.set(id, key);
  }
  return ring;
}

/**
 * Envelope encryption with Web Crypto (runs on Node and Workers): every record gets a fresh
 * AES-256-GCM data key, which is wrapped by the keyring key `activeKeyId`. Old records stay
 * readable after rotation as long as their key id remains in the keyring.
 * Format: `v1.<keyId>.<wrapped data key>.<iv>.<ciphertext>` (base64url parts).
 */
export function createEnvelopeCipher(keyring: Keyring, activeKeyId: string): TextCipher {
  if (!keyring.has(activeKeyId)) throw new Error("Active encryption key id is not in the keyring");
  const kekCache = new Map<string, Promise<CryptoKey>>();
  const kek = (id: string): Promise<CryptoKey> => {
    let cached = kekCache.get(id);
    if (!cached) {
      const raw = keyring.get(id);
      if (!raw) return Promise.reject(new Error(`Unknown encryption key id: ${id}`));
      cached = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
      kekCache.set(id, cached);
    }
    return cached;
  };

  return {
    async encrypt(plaintext: string, context: string): Promise<SealedText> {
      const aad = utf8(context);
      const dek = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
        "encrypt",
      ]);
      const iv = randomBytes(IV_BYTES);
      const body = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        dek,
        utf8(plaintext),
      );
      const wrapIv = randomBytes(IV_BYTES);
      const rawDek = await crypto.subtle.exportKey("raw", dek);
      const wrapped = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: wrapIv, additionalData: aad },
        await kek(activeKeyId),
        rawDek,
      );
      const wrappedDek = concat(wrapIv, new Uint8Array(wrapped));
      return {
        keyId: activeKeyId,
        ciphertext: [
          VERSION,
          activeKeyId,
          b64url(wrappedDek),
          b64url(iv),
          b64url(new Uint8Array(body)),
        ].join("."),
      };
    },

    async decrypt(ciphertext: string, context: string): Promise<string> {
      const parts = ciphertext.split(".");
      const [version, keyId, wrappedPart, ivPart, bodyPart] = parts;
      if (
        parts.length !== 5 ||
        version !== VERSION ||
        !keyId ||
        !wrappedPart ||
        !ivPart ||
        !bodyPart
      ) {
        throw new Error("Malformed ciphertext");
      }
      const aad = utf8(context);
      const wrappedDek = fromBase64(wrappedPart);
      const rawDek = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: wrappedDek.slice(0, IV_BYTES), additionalData: aad },
        await kek(keyId),
        wrappedDek.slice(IV_BYTES),
      );
      const dek = await crypto.subtle.importKey("raw", rawDek, "AES-GCM", false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(ivPart), additionalData: aad },
        dek,
        fromBase64(bodyPart),
      );
      return new TextDecoder().decode(plain);
    },
  };
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Accepts base64 and base64url; throws on invalid input. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
