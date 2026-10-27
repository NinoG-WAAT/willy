export interface PasswordHasher {
  /** Returns a self-describing, salted hash to store. */
  hash(password: string): Promise<string>;
  /**
   * Verifies a password. A null `stored` (unknown owner) must still do comparable work and
   * return false, so response time does not reveal which emails exist.
   */
  verify(password: string, stored: string | null): Promise<boolean>;
}
