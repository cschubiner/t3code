import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useThreadNavigationHistoryStore } from "./threadNavigationHistoryStore";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const THREAD_C = ThreadId.makeUnsafe("thread-c");
const THREAD_MISSING = ThreadId.makeUnsafe("thread-missing");

describe("threadNavigationHistoryStore", () => {
  beforeEach(() => {
    useThreadNavigationHistoryStore.getState().clearHistory();
  });

  it("records visits without duplicating consecutive thread selections", () => {
    const store = useThreadNavigationHistoryStore.getState();
    store.recordVisit(THREAD_A);
    store.recordVisit(THREAD_A);
    store.recordVisit(THREAD_B);

    const state = useThreadNavigationHistoryStore.getState();
    expect(state.entries).toEqual([THREAD_A, THREAD_B]);
    expect(state.index).toBe(1);
  });

  it("moves backward and forward through recorded history", () => {
    const store = useThreadNavigationHistoryStore.getState();
    store.recordVisit(THREAD_A);
    store.recordVisit(THREAD_B);
    store.recordVisit(THREAD_C);

    expect(store.navigateHistory("previous", [THREAD_A, THREAD_B, THREAD_C])).toBe(THREAD_B);
    store.recordVisit(THREAD_B);
    expect(store.navigateHistory("next", [THREAD_A, THREAD_B, THREAD_C])).toBe(THREAD_C);
  });

  it("truncates forward history after a new selection", () => {
    const store = useThreadNavigationHistoryStore.getState();
    store.recordVisit(THREAD_A);
    store.recordVisit(THREAD_B);
    store.recordVisit(THREAD_C);

    expect(store.navigateHistory("previous", [THREAD_A, THREAD_B, THREAD_C])).toBe(THREAD_B);
    store.recordVisit(THREAD_B);
    store.recordVisit(THREAD_A);

    const state = useThreadNavigationHistoryStore.getState();
    expect(state.entries).toEqual([THREAD_A, THREAD_B, THREAD_A]);
    expect(store.navigateHistory("next", [THREAD_A, THREAD_B, THREAD_C])).toBeNull();
  });

  it("skips missing history entries when navigating", () => {
    const store = useThreadNavigationHistoryStore.getState();
    store.recordVisit(THREAD_A);
    store.recordVisit(THREAD_MISSING);
    store.recordVisit(THREAD_C);

    expect(store.navigateHistory("previous", [THREAD_A, THREAD_C])).toBe(THREAD_A);
  });
});
