/**
 * Obviously fake development keys (never secrets): they let seeds, tests and a fresh local
 * checkout run through the real ciphers. Production must set ENCRYPTION_KEYS and
 * FILE_URL_SECRET; the Node composition refuses to fall back to these when NODE_ENV=production.
 */
export const DEV_KEYRING = {
  spec: `dev:${btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))}`,
  activeKeyId: "dev",
};

export const DEV_FILE_URL_SECRET = "development-only-file-url-secret-not-for-production";
