import type { Clock } from "../../ports/clock";
import type { IdGenerator, TokenGenerator } from "../../ports/id-generator";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** UUIDs for ids; 32 random bytes (base64url) for secrets. */
export class RandomIds implements IdGenerator, TokenGenerator {
  newId(): string {
    return crypto.randomUUID();
  }

  newToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }
}
