import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useThreadSearchNavigationStore } from "./threadSearchNavigationStore";

describe("threadSearchNavigationStore", () => {
  beforeEach(() => {
    useThreadSearchNavigationStore.getState().clearPendingNavigation();
  });

  it("stores and consumes content-match requests for the destination thread", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const otherThreadId = ThreadId.makeUnsafe("thread-2");
    useThreadSearchNavigationStore.getState().setPendingNavigation({
      threadId,
      query: "needle",
      kind: "content-match",
      sourceKind: "message",
      sourceId: "message-1",
      occurrenceIndexInSource: 2,
    });

    expect(
      useThreadSearchNavigationStore.getState().consumePendingNavigation(otherThreadId),
    ).toBeNull();

    expect(useThreadSearchNavigationStore.getState().consumePendingNavigation(threadId)).toEqual({
      threadId,
      query: "needle",
      kind: "content-match",
      sourceKind: "message",
      sourceId: "message-1",
      occurrenceIndexInSource: 2,
    });
    expect(useThreadSearchNavigationStore.getState().pendingNavigation).toBeNull();
  });

  it("stores and consumes title-match requests", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    useThreadSearchNavigationStore.getState().setPendingNavigation({
      threadId,
      query: "alpha",
      kind: "title-match",
    });

    expect(useThreadSearchNavigationStore.getState().consumePendingNavigation(threadId)).toEqual({
      threadId,
      query: "alpha",
      kind: "title-match",
    });
  });

  it("clears stale navigation requests", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    useThreadSearchNavigationStore.getState().setPendingNavigation({
      threadId,
      query: "alpha",
      kind: "title-match",
    });

    useThreadSearchNavigationStore.getState().clearPendingNavigation();

    expect(useThreadSearchNavigationStore.getState().consumePendingNavigation(threadId)).toBeNull();
  });
});
