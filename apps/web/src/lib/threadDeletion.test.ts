import { describe, expect, it } from "vitest";
import { ThreadId } from "@t3tools/contracts";

import { resolveThreadDeletionNavigationTarget } from "./threadDeletion";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const THREAD_C = ThreadId.makeUnsafe("thread-c");
const THREAD_D = ThreadId.makeUnsafe("thread-d");

describe("resolveThreadDeletionNavigationTarget", () => {
  it("navigates to the next visible thread after the deleted thread", () => {
    expect(
      resolveThreadDeletionNavigationTarget({
        deletedThreadId: THREAD_B,
        orderedThreadIds: [THREAD_A, THREAD_B, THREAD_C, THREAD_D],
      }),
    ).toBe(THREAD_C);
  });

  it("skips threads that are being deleted in the same batch", () => {
    expect(
      resolveThreadDeletionNavigationTarget({
        deletedThreadId: THREAD_B,
        orderedThreadIds: [THREAD_A, THREAD_B, THREAD_C, THREAD_D],
        deletedThreadIds: new Set([THREAD_B, THREAD_C]),
      }),
    ).toBe(THREAD_D);
  });

  it("returns null when there is no next surviving thread", () => {
    expect(
      resolveThreadDeletionNavigationTarget({
        deletedThreadId: THREAD_D,
        orderedThreadIds: [THREAD_A, THREAD_B, THREAD_C, THREAD_D],
      }),
    ).toBeNull();
  });

  it("falls back to the first surviving thread when the deleted thread is not in the ordered list", () => {
    expect(
      resolveThreadDeletionNavigationTarget({
        deletedThreadId: ThreadId.makeUnsafe("thread-missing"),
        orderedThreadIds: [THREAD_A, THREAD_B, THREAD_C],
        deletedThreadIds: new Set([THREAD_B]),
      }),
    ).toBe(THREAD_A);
  });
});
