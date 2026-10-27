import type { CalendarEvent } from "../../domain/calendar/event";
import { providerError } from "../../domain/platform/provider-error";
import { err, ok } from "../../domain/platform/result";
import type { CalendarSource } from "../../ports/calendar-source";

export interface FixtureCalendarOptions {
  now: () => Date;
  /** Owners whose (simulated) provider is down: lets the failure state be demonstrated and tested. */
  downOwners: readonly string[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Development and test stand-in for the calendar provider (CALENDAR_PROVIDER=fake). Every owner
 * sees the same clearly labelled demo events, scheduled relative to "now" so the home screen
 * always has something upcoming. It stores nothing and contacts nothing.
 */
export function createFixtureCalendarSource(options: FixtureCalendarOptions): CalendarSource {
  const events = (): CalendarEvent[] => {
    const nextHour = Math.ceil(options.now().getTime() / HOUR_MS) * HOUR_MS;
    const at = (offsetMs: number, durationMs: number) => ({
      startsAt: new Date(nextHour + offsetMs).toISOString(),
      endsAt: new Date(nextHour + offsetMs + durationMs).toISOString(),
    });
    return [
      {
        provider: "google",
        providerEventId: "fake-customer-call",
        title: "Customer call with Grace (demo)",
        ...at(DAY_MS, HOUR_MS / 2),
        timezone: "Europe/Paris",
        attendees: [{ name: "Grace Hopper", email: "grace@example.com" }],
      },
      {
        provider: "google",
        providerEventId: "fake-investor-update",
        title: "Investor update (demo)",
        ...at(3 * DAY_MS, HOUR_MS),
        timezone: "Europe/Paris",
        attendees: [
          { name: "Dana Investor", email: "dana@example.com" },
          { name: "Alan Turing", email: "alan@example.com" },
        ],
      },
    ];
  };

  return {
    listEvents(ownerId, range) {
      if (options.downOwners.includes(ownerId)) {
        return Promise.resolve(
          err(providerError("unavailable", "the demo calendar is simulating an outage")),
        );
      }
      const from = Date.parse(range.from);
      const to = Date.parse(range.to);
      return Promise.resolve(
        ok(events().filter((e) => Date.parse(e.startsAt) >= from && Date.parse(e.startsAt) < to)),
      );
    },
  };
}
