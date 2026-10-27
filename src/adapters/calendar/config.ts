import { err, ok, type Result } from "../../domain/platform/result";

export type CalendarConfig =
  | { mode: "fake" }
  | {
      mode: "google";
      clientId: string;
      clientSecret: string;
      redirectAllowlist: string[];
      webhookSecret: string;
      stateSecret: string;
    };

export type EnvLike = Readonly<Record<string, string | undefined>>;

const REQUIRED_FOR_GOOGLE = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URIS",
  "CALENDAR_WEBHOOK_SECRET",
  "OAUTH_STATE_SECRET",
] as const;

/**
 * Reads calendar settings from the environment. Defaults to the fake so a fresh checkout runs
 * without any secrets. Errors name variables only, never their values.
 */
export function readCalendarConfig(env: EnvLike): Result<CalendarConfig, string> {
  const provider = env["CALENDAR_PROVIDER"] ?? "fake";
  if (provider === "fake") return ok({ mode: "fake" });
  if (provider !== "google") return err("CALENDAR_PROVIDER must be 'fake' or 'google'");

  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of REQUIRED_FOR_GOOGLE) {
    const value = env[name];
    if (value) values[name] = value;
    else missing.push(name);
  }
  if (missing.length > 0) return err(`missing environment variables: ${missing.join(", ")}`);

  return ok({
    mode: "google",
    clientId: values["GOOGLE_OAUTH_CLIENT_ID"] ?? "",
    clientSecret: values["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "",
    redirectAllowlist: (values["GOOGLE_OAUTH_REDIRECT_URIS"] ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    webhookSecret: values["CALENDAR_WEBHOOK_SECRET"] ?? "",
    stateSecret: values["OAUTH_STATE_SECRET"] ?? "",
  });
}
