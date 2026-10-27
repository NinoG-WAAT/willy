import { describe, expect, it } from "vitest";
import { createFakeCalendarSource } from "../../../src/adapters/calendar/fake-calendar-source";
import { RANGE, makeEvent } from "../../support/calendar-fixtures";
import { calendarSourceContract } from "./calendar-source.contract";

calendarSourceContract("fake", () => {
  const fake = createFakeCalendarSource();
  return { source: fake, seed: fake.seed, failNext: (kind) => fake.failNext(kind) };
});

describe("fake calendar source specifics", () => {
  it("can fail several times in a row for retry tests", async () => {
    const fake = createFakeCalendarSource();
    fake.seed("o", [makeEvent("x")]);
    fake.failNext("unavailable", 2);
    expect((await fake.listEvents("o", RANGE)).ok).toBe(false);
    expect((await fake.listEvents("o", RANGE)).ok).toBe(false);
    expect((await fake.listEvents("o", RANGE)).ok).toBe(true);
  });

  it("returns defensive copies so callers cannot mutate the fixture", async () => {
    const fake = createFakeCalendarSource();
    fake.seed("o", [makeEvent("x")]);
    const first = await fake.listEvents("o", RANGE);
    if (first.ok) first.value[0]!.title = "mutated";
    const second = await fake.listEvents("o", RANGE);
    expect(second.ok && second.value[0]?.title).toBe("Meeting x");
  });
});
