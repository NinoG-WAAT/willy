import type { Result } from "../platform/result";
import { err, ok } from "../platform/result";
import { hmacSha256Hex, verifyHmacSha256Hex } from "./hmac";

export type WebhookSignatureError = "missing" | "malformed" | "stale" | "mismatch";

export const WEBHOOK_TOLERANCE_SEC = 300;

/** Header format: `t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<raw body>">`. */
export async function signWebhook(
  secret: string,
  timestampSec: number,
  body: string,
): Promise<string> {
  const ts = String(timestampSec);
  return `t=${ts},v1=${await hmacSha256Hex(secret, `${ts}.${body}`)}`;
}

export async function verifyWebhookSignature(input: {
  secret: string;
  header: string | null;
  body: string;
  nowSec: number;
  toleranceSec?: number;
}): Promise<Result<void, WebhookSignatureError>> {
  if (input.header === null || input.header === "") return err("missing");
  const parts = new Map(
    input.header.split(",").map((p) => p.trim().split("=", 2) as [string, string | undefined]),
  );
  const t = parts.get("t");
  const v1 = parts.get("v1");
  if (t === undefined || v1 === undefined || !/^\d{1,12}$/.test(t) || !/^[0-9a-f]+$/i.test(v1)) {
    return err("malformed");
  }
  const timestamp = Number(t);
  // Check the MAC before the clock so an attacker learns nothing about timing windows from errors.
  const valid = await verifyHmacSha256Hex(input.secret, `${t}.${input.body}`, v1);
  if (!valid) return err("mismatch");
  if (Math.abs(input.nowSec - timestamp) > (input.toleranceSec ?? WEBHOOK_TOLERANCE_SEC))
    return err("stale");
  return ok(undefined);
}
