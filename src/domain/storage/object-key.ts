const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MAX_KEY_LENGTH = 512;
const MAX_SEGMENTS = 8;
/** Suffix the local filesystem store uses for metadata files; no object may collide with it. */
const RESERVED_SUFFIX = ".__meta";

/** Owner and meeting ids as they appear in object keys: no separators, dots or unicode. */
export function isValidStorageId(id: string): boolean {
  return ID.test(id);
}

const validSegment = (s: string): boolean =>
  SEGMENT.test(s) && !s.includes("..") && !s.endsWith(RESERVED_SUFFIX);

/**
 * Object keys are `owner/<ownerId>/...`: every object lives under its owner's prefix, and keys
 * can never contain traversal, empty segments, backslashes, control characters or odd unicode.
 */
export function isValidObjectKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  const segments = key.split("/");
  if (segments.length < 3 || segments.length > MAX_SEGMENTS) return false;
  const [root, ownerId] = segments;
  return root === "owner" && isValidStorageId(ownerId ?? "") && segments.every(validSegment);
}

/**
 * Deletion by prefix is only allowed for a directory inside an owner's space (at least
 * `owner/<id>/`) and the prefix must end with `/`, so `m1/` can never match `m10/`.
 */
export function isSafePrefix(prefix: string): boolean {
  if (!prefix.endsWith("/")) return false;
  const segments = prefix.slice(0, -1).split("/");
  if (segments.length < 2 || segments.length > MAX_SEGMENTS) return false;
  const [root, ownerId] = segments;
  return root === "owner" && isValidStorageId(ownerId ?? "") && segments.every(validSegment);
}

function assertId(id: string, what: string): void {
  if (!isValidStorageId(id)) throw new Error(`invalid ${what} for an object key`);
}

export function ownerPrefix(ownerId: string): string {
  assertId(ownerId, "owner id");
  return `owner/${ownerId}/`;
}

export function meetingPrefix(ownerId: string, meetingId: string): string {
  assertId(meetingId, "meeting id");
  return `${ownerPrefix(ownerId)}meeting/${meetingId}/`;
}

/** Throws for ids that could escape the prefix: they come from our own database, so it is a bug. */
export function chunkObjectKey(ownerId: string, meetingId: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 0)
    throw new Error("invalid chunk sequence for an object key");
  return `${meetingPrefix(ownerId, meetingId)}chunk-${String(seq)}`;
}

export function isOwnedBy(ownerId: string, key: string): boolean {
  return isValidStorageId(ownerId) && key.startsWith(`owner/${ownerId}/`);
}
