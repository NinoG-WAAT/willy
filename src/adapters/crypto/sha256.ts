const hex = (digest: ArrayBuffer): string =>
  [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Lower-case hex SHA-256; used to store session tokens as hashes. */
export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Lower-case hex SHA-256 of binary data (chunk replay detection). */
export async function sha256HexBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}
