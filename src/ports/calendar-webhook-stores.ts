/** Dedupes provider deliveries by (provider, event id); backed by a UNIQUE constraint in the real store. */
export interface ProviderEventStore {
  /** Atomically records the event. Returns false if it had already been claimed. */
  claim(provider: string, eventId: string): Promise<boolean>;
  /** Undo a claim when processing failed, so the provider's retry is processed. */
  release(provider: string, eventId: string): Promise<void>;
  hasSeen(provider: string, eventId: string): Promise<boolean>;
}

/** Resolves which Owner a webhook channel belongs to. The payload never names an owner. */
export interface CalendarConnections {
  ownerForChannel(channelId: string): Promise<string | null>;
}
