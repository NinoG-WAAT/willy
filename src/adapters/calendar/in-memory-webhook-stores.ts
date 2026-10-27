import type { CalendarConnections, ProviderEventStore } from "../../ports/calendar-webhook-stores";

export function createInMemoryProviderEventStore(): ProviderEventStore {
  const seen = new Set<string>();
  const key = (provider: string, eventId: string) => JSON.stringify([provider, eventId]);
  return {
    claim(provider, eventId) {
      const k = key(provider, eventId);
      if (seen.has(k)) return Promise.resolve(false);
      seen.add(k);
      return Promise.resolve(true);
    },
    release(provider, eventId) {
      seen.delete(key(provider, eventId));
      return Promise.resolve();
    },
    hasSeen(provider, eventId) {
      return Promise.resolve(seen.has(key(provider, eventId)));
    },
  };
}

export function createInMemoryCalendarConnections(
  ownerByChannel: Record<string, string>,
): CalendarConnections {
  const map = new Map(Object.entries(ownerByChannel));
  return { ownerForChannel: (channelId) => Promise.resolve(map.get(channelId) ?? null) };
}
