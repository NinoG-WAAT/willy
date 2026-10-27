import type { Clock } from "../../ports/clock";
import type { IdGenerator, TokenGenerator } from "../../ports/id-generator";

/** Deterministic clock for tests; time only moves when the test says so. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Deterministic ids and tokens (`prefix-1`, `prefix-2`, ...). Never use outside tests. */
export class SequentialIds implements IdGenerator, TokenGenerator {
  private n = 0;

  constructor(private readonly prefix: string) {}

  newId(): string {
    this.n += 1;
    return `${this.prefix}-${String(this.n)}`;
  }

  newToken(): string {
    return this.newId();
  }
}
