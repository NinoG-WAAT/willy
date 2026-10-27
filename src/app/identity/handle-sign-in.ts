import { z } from "zod";
import { isSameOrigin, tokensMatch } from "../../domain/identity/csrf";
import { safeNextPath } from "../../domain/identity/next-path";
import type { IdentityDeps } from "./deps";
import { signIn, type SignInLimits } from "./sign-in";

export interface SignInRequest {
  form: FormData;
  /** Origin request header (null when absent). */
  origin: string | null;
  expectedOrigin: string;
  /** Value of the pre-session login CSRF cookie. */
  loginCsrfCookie: string | undefined;
  clientKey: string;
  currentSessionToken?: string | undefined;
  limits?: SignInLimits;
}

export type SignInOutcome =
  | { kind: "signed_in"; token: string; expiresAt: Date; next: string }
  | {
      kind: "rejected";
      status: 400 | 401 | 403 | 429;
      message: string;
      retryAfterSeconds?: number;
    };

// Unknown fields are rejected, every field is length-limited (OWASP input validation).
const FormSchema = z.strictObject({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(200),
  next: z.string().max(2000).optional(),
  csrf_token: z.string().min(1).max(200),
});

/**
 * Sign-in form handling: CSRF proof (double-submit cookie + Origin) first, then validation, then
 * the sign-in use case. Messages are generic so they never reveal which emails exist.
 */
export async function handleSignIn(deps: IdentityDeps, req: SignInRequest): Promise<SignInOutcome> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of req.form.entries()) fields[key] = value;

  const submittedToken =
    typeof fields["csrf_token"] === "string" ? fields["csrf_token"] : undefined;
  if (
    !isSameOrigin(req.origin, req.expectedOrigin) ||
    !req.loginCsrfCookie ||
    !tokensMatch(req.loginCsrfCookie, submittedToken)
  ) {
    return {
      kind: "rejected",
      status: 403,
      message: "Your request could not be verified. Reload the page and try again.",
    };
  }

  const parsed = FormSchema.safeParse(fields);
  if (!parsed.success) {
    return { kind: "rejected", status: 400, message: "Enter your email and password." };
  }

  const result = await signIn(deps, {
    email: parsed.data.email,
    password: parsed.data.password,
    clientKey: req.clientKey,
    currentSessionToken: req.currentSessionToken,
    ...(req.limits ? { limits: req.limits } : {}),
  });
  if (result.ok) {
    return {
      kind: "signed_in",
      token: result.value.token,
      expiresAt: result.value.expiresAt,
      next: safeNextPath(parsed.data.next),
    };
  }
  if (result.error.kind === "rate_limited") {
    const minutes = Math.max(1, Math.ceil(result.error.retryAfterSeconds / 60));
    return {
      kind: "rejected",
      status: 429,
      message: `Too many attempts. Try again in ${String(minutes)} minute${minutes === 1 ? "" : "s"}.`,
      retryAfterSeconds: result.error.retryAfterSeconds,
    };
  }
  return { kind: "rejected", status: 401, message: "Email or password is incorrect." };
}
