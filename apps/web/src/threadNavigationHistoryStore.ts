import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

export type ThreadHistoryDirection = "previous" | "next";

export interface ThreadNavigationHistoryState {
  entries: readonly ThreadId[];
  index: number;
  pendingThreadId: ThreadId | null;
}

interface ThreadNavigationHistoryStore extends ThreadNavigationHistoryState {
  recordVisit: (threadId: ThreadId) => void;
  navigateHistory: (
    direction: ThreadHistoryDirection,
    availableThreadIds: readonly ThreadId[],
  ) => ThreadId | null;
  clearHistory: () => void;
}

function resolveHistoryIndex(input: {
  entries: readonly ThreadId[];
  index: number;
  direction: ThreadHistoryDirection;
  availableThreadIds: readonly ThreadId[];
}): number {
  const availableThreadIdSet = new Set(input.availableThreadIds);
  const step = input.direction === "previous" ? -1 : 1;

  for (
    let candidateIndex = input.index + step;
    candidateIndex >= 0 && candidateIndex < input.entries.length;
    candidateIndex += step
  ) {
    const candidate = input.entries[candidateIndex];
    if (candidate && availableThreadIdSet.has(candidate)) {
      return candidateIndex;
    }
  }

  return -1;
}

const EMPTY_STATE: ThreadNavigationHistoryState = {
  entries: [],
  index: -1,
  pendingThreadId: null,
};

export const useThreadNavigationHistoryStore = create<ThreadNavigationHistoryStore>((set, get) => ({
  ...EMPTY_STATE,

  recordVisit: (threadId) => {
    set((state) => {
      if (state.pendingThreadId === threadId) {
        if (state.pendingThreadId === null) {
          return state;
        }
        return { pendingThreadId: null };
      }

      const currentThreadId = state.index >= 0 ? (state.entries[state.index] ?? null) : null;
      if (currentThreadId === threadId && state.pendingThreadId === null) {
        return state;
      }

      const entriesBeforeCurrent =
        state.index >= 0 ? state.entries.slice(0, state.index + 1) : state.entries.slice(0, 0);
      if (entriesBeforeCurrent.at(-1) === threadId) {
        return {
          entries: entriesBeforeCurrent,
          index: entriesBeforeCurrent.length - 1,
          pendingThreadId: null,
        };
      }

      const nextEntries = [...entriesBeforeCurrent, threadId];
      return {
        entries: nextEntries,
        index: nextEntries.length - 1,
        pendingThreadId: null,
      };
    });
  },

  navigateHistory: (direction, availableThreadIds) => {
    const nextIndex = resolveHistoryIndex({
      entries: get().entries,
      index: get().index,
      direction,
      availableThreadIds,
    });
    if (nextIndex === -1) {
      return null;
    }

    const nextThreadId = get().entries[nextIndex] ?? null;
    if (nextThreadId === null) {
      return null;
    }

    set({
      index: nextIndex,
      pendingThreadId: nextThreadId,
    });
    return nextThreadId;
  },

  clearHistory: () => {
    const state = get();
    if (
      state.entries.length === 0 &&
      state.index === EMPTY_STATE.index &&
      state.pendingThreadId === EMPTY_STATE.pendingThreadId
    ) {
      return;
    }
    set(EMPTY_STATE);
  },
}));
