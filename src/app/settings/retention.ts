import type { Result } from "../../domain/platform/result";
import { err, ok } from "../../domain/platform/result";
import type { FieldError } from "../../domain/platform/text";
import {
  parseRetention,
  type RetentionInput,
  type RetentionSettings,
} from "../../domain/settings/retention";
import type { Clock } from "../../ports/clock";
import type { SettingsRepository } from "../../ports/settings-repository";

export interface RetentionDeps {
  settings: SettingsRepository;
  clock: Clock;
}

export const loadRetention = (deps: RetentionDeps, ownerId: string): Promise<RetentionSettings> =>
  deps.settings.get(ownerId);

/** Validates against the owner's stored settings, then stores; only this owner's row changes. */
export async function saveRetention(
  deps: RetentionDeps,
  ownerId: string,
  input: RetentionInput,
): Promise<Result<RetentionSettings, FieldError[]>> {
  const parsed = parseRetention(input, await deps.settings.get(ownerId));
  if (!parsed.ok) return err(parsed.error);
  await deps.settings.save(ownerId, parsed.value, deps.clock.now());
  return ok(parsed.value);
}
