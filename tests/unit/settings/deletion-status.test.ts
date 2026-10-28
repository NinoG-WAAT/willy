import { describe, expect, it } from "vitest";
import {
  describeDeletion,
  type DeletionJobView,
} from "../../../src/domain/settings/deletion-status";

const job = (over: Partial<DeletionJobView> = {}): DeletionJobView => ({
  status: "pending",
  attempts: 0,
  maxAttempts: 5,
  nextRunAt: null,
  lastErrorCode: null,
  ...over,
});

describe("describeDeletion", () => {
  it("pending: queued, in progress, nothing to retry", () => {
    expect(describeDeletion(job())).toMatchObject({
      state: "pending",
      label: "Queued",
      inProgress: true,
      canRetry: false,
    });
  });

  it("running: deleting", () => {
    expect(describeDeletion(job({ status: "running", attempts: 1 }))).toMatchObject({
      state: "running",
      label: "Deleting",
      inProgress: true,
      canRetry: false,
    });
  });

  it("retrying: names the attempt and the redacted reason", () => {
    const view = describeDeletion(
      job({ status: "retrying", attempts: 2, lastErrorCode: "storage_unavailable" }),
    );
    expect(view).toMatchObject({ state: "retrying", label: "Retrying", inProgress: true });
    expect(view.detail).toContain("2 of 5");
    expect(view.detail).toContain("storage_unavailable");
    expect(view.canRetry).toBe(false);
  });

  it("failed: stopped, retryable, and says the meeting stays hidden", () => {
    const view = describeDeletion(
      job({ status: "failed", attempts: 5, lastErrorCode: "storage_unavailable" }),
    );
    expect(view).toMatchObject({
      state: "failed",
      label: "Failed",
      inProgress: false,
      canRetry: true,
    });
    expect(view.detail).toMatch(/hidden/i);
    expect(view.detail).toMatch(/retried automatically/i);
  });

  it("succeeded: lists what is gone", () => {
    const view = describeDeletion(job({ status: "succeeded", attempts: 1 }));
    expect(view).toMatchObject({
      state: "succeeded",
      label: "Deleted",
      inProgress: false,
      canRetry: false,
    });
    expect(view.detail).toMatch(/note.*transcript.*audio.*search/is);
  });

  it("never prints an error code that is not a plain code", () => {
    const view = describeDeletion(
      job({ status: "failed", lastErrorCode: "boom Bearer secret-token" }),
    );
    expect(view.detail).not.toContain("secret-token");
  });
});
