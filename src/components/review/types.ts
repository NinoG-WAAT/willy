import type { FieldError } from "../../domain/platform/text";
import type { JobProgress } from "../../domain/progress/text";

/**
 * Shapes shared by the review components (src/pages/meetings/[id]/review.astro passes them in).
 * The page loads the data and computes these once; the components only render them.
 */

/** A link from a summary item to the transcript lines it was written from. */
export interface SourceLink {
  label: string;
  href: string;
  from: number;
  to: number;
}

/** Null when the item has no transcript source (the owner added it). */
export type SourceLinkFor = (from: number | null, to: number | null) => SourceLink | null;

/** The value to show in a field: what the owner typed into a rejected form, else the stored one. */
export type Typed = (key: string, name: string, fallback: string) => string;

/** Same idea for a checkbox: whether it was ticked in a rejected form, else the stored state. */
export type Checked = (key: string, name: string, fallback: boolean) => boolean;

/** The errors of one field of the rejected form that belongs to `key` (an item id or an intent). */
export type ErrorsFor = (key: string, field: string) => FieldError[];

/** Whether a search result points at this very item (it is then marked "Search match"). */
export type IsHit = (kind: string, itemId: string) => boolean;

/** Whether the transcript line at this position is inside the highlighted source range. */
export type InSource = (position: number) => boolean;

/** The latest regeneration request: of one section, or (sectionId null) of the whole draft. */
export type Regeneration = JobProgress & { sectionId: string | null };

export interface Speaker {
  name: string;
  lines: number;
}
