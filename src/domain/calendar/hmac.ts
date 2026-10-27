const encoder = new TextEncoder();

async function importKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const mac = await crypto.subtle.sign(
    "HMAC",
    await importKey(secret, "sign"),
    encoder.encode(data),
  );
  return toHex(new Uint8Array(mac));
}

/** Constant-time comparison: WebCrypto's verify does not short-circuit on the first differing byte. */
export async function verifyHmacSha256Hex(
  secret: string,
  data: string,
  signatureHex: string,
): Promise<boolean> {
  const signature = fromHex(signatureHex);
  if (!signature) return false;
  return crypto.subtle.verify(
    "HMAC",
    await importKey(secret, "verify"),
    signature,
    encoder.encode(data),
  );
}
