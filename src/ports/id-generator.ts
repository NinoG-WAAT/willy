/** Source of ids and unguessable tokens; domain code never calls Math.random or crypto directly. */
export interface IdGenerator {
  newId(): string;
}

export interface TokenGenerator {
  /** Unguessable, URL-safe secret (session tokens, CSRF secrets). */
  newToken(): string;
}
