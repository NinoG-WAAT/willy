import type { PasswordHasher } from "../../ports/password-hasher";

const PREFIX = "pbkdf2-sha256";
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const MIN_ITERATIONS = 1000;
const MAX_ITERATIONS = 10_000_000;
/** Cloudflare Workers cap PBKDF2 at 100,000 iterations; the count is stored so it can be raised. */
export const DEFAULT_ITERATIONS = 100_000;
const MAX_PASSWORD_LENGTH = 1024;

/** PBKDF2-SHA256 through Web Crypto (Node and Workers). Format: `pbkdf2-sha256$iter$salt$hash`. */
export function createPbkdf2Hasher(options: { iterations?: number } = {}): PasswordHasher {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error("PBKDF2 iteration count out of range");
  }
  // Fixed-cost target for unknown owners so a miss costs about as much as a hit.
  const decoy = derive("decoy", crypto.getRandomValues(new Uint8Array(SALT_BYTES)), iterations);

  return {
    async hash(password) {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
      const hash = await derive(password, salt, iterations);
      return [PREFIX, String(iterations), toB64(salt), toB64(hash)].join("$");
    },

    async verify(password, stored) {
      const parsed = stored === null ? null : parse(stored);
      if (!parsed || password.length > MAX_PASSWORD_LENGTH) {
        await decoy;
        await derive(
          password.slice(0, MAX_PASSWORD_LENGTH),
          new Uint8Array(SALT_BYTES),
          iterations,
        );
        return false;
      }
      const actual = await derive(password, parsed.salt, parsed.iterations);
      return equal(actual, parsed.hash);
    },
  };
}

interface Parsed {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  hash: Uint8Array<ArrayBuffer>;
}

function parse(stored: string): Parsed | null {
  const [prefix, iter, salt, hash, extra] = stored.split("$");
  if (prefix !== PREFIX || !iter || !salt || !hash || extra !== undefined) return null;
  const iterations = Number(iter);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    return null;
  }
  try {
    return { iterations, salt: fromB64(salt), hash: fromB64(hash) };
  } catch {
    return null;
  }
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromB64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
