import type { CalendarCredentialStore } from "../../ports/calendar-credential-store";

export function createInMemoryCredentialStore(): CalendarCredentialStore {
  const sealedByOwner = new Map<string, string>();
  return {
    load: (ownerId) => Promise.resolve(sealedByOwner.get(ownerId) ?? null),
    save: (ownerId, sealed) => {
      sealedByOwner.set(ownerId, sealed);
      return Promise.resolve();
    },
  };
}
