import { msg, t } from "../../i18n/translate";

/**
 * The consent statement the Owner ticks (English source). Changing the meaning of the wording
 * bumps `CONSENT_STATEMENT_VERSION` in lifecycle.ts, and the version is stored with the
 * confirmation. It only ever covers the Owner's own attestation: the system never records or
 * claims consent on behalf of participants.
 *
 * It lives apart from the lifecycle so the sentence reaches only the screens that show it (the
 * live note, rendered on the server), never the scripts that import the lifecycle.
 */
export const CONSENT_STATEMENT = msg(
  "I have told every participant that this meeting will be recorded and transcribed, and I have their consent.",
);

/**
 * The statement in the request's language. The French is a faithful translation of the same
 * attestation, so it shares the version: the rule is unchanged, only the language of the words.
 */
export const consentStatement = (): string => t(CONSENT_STATEMENT);
