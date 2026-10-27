import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhookSignature } from "../../../src/domain/calendar/webhook-signature";

const secret = "test-webhook-secret";
const body = '{"eventId":"e1"}';

describe("webhook signature", () => {
  it("accepts a correctly signed body inside the tolerance window", async () => {
    const header = await signWebhook(secret, 1_000, body);
    expect(await verifyWebhookSignature({ secret, header, body, nowSec: 1_100 })).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it.each([
    ["missing header", null, "missing"],
    ["garbage header", "nonsense", "malformed"],
    ["non numeric timestamp", "t=abc,v1=00", "malformed"],
    ["non hex signature", "t=1000,v1=zz", "malformed"],
  ])("rejects %s", async (_label, header, reason) => {
    const result = await verifyWebhookSignature({ secret, header, body, nowSec: 1_000 });
    expect(result).toEqual({ ok: false, error: reason });
  });

  it("rejects a tampered body", async () => {
    const header = await signWebhook(secret, 1_000, body);
    const result = await verifyWebhookSignature({ secret, header, body: body + " ", nowSec: 1_000 });
    expect(result).toEqual({ ok: false, error: "mismatch" });
  });

  it("rejects a wrong secret", async () => {
    const header = await signWebhook("other", 1_000, body);
    expect(await verifyWebhookSignature({ secret, header, body, nowSec: 1_000 })).toEqual({
      ok: false,
      error: "mismatch",
    });
  });

  it("rejects a replayed old timestamp and a far-future one", async () => {
    const header = await signWebhook(secret, 1_000, body);
    expect(await verifyWebhookSignature({ secret, header, body, nowSec: 1_000 + 301 })).toEqual({
      ok: false,
      error: "stale",
    });
    expect(await verifyWebhookSignature({ secret, header, body, nowSec: 1_000 - 301 })).toEqual({
      ok: false,
      error: "stale",
    });
  });

  it("does not let a signature for one timestamp validate another", async () => {
    const header = await signWebhook(secret, 1_000, body);
    const forged = header.replace("t=1000", "t=1200");
    expect(await verifyWebhookSignature({ secret, header: forged, body, nowSec: 1_200 })).toEqual({
      ok: false,
      error: "mismatch",
    });
  });
});
