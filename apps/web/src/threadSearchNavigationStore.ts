import type { MessageId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

export type ThreadSearchNavigationRequest =
  | {
      threadId: ThreadId;
      query: string;
      kind: "content-match";
      sourceKind: "message" | "proposed-plan";
      sourceId: MessageId | string;
      occurrenceIndexInSource: number;
    }
  | {
      threadId: ThreadId;
      query: string;
      kind: "title-match";
    };

interface ThreadSearchNavigationStore {
  pendingNavigation: ThreadSearchNavigationRequest | null;
  setPendingNavigation: (request: ThreadSearchNavigationRequest) => void;
  consumePendingNavigation: (threadId: ThreadId) => ThreadSearchNavigationRequest | null;
  clearPendingNavigation: () => void;
}

export const useThreadSearchNavigationStore = create<ThreadSearchNavigationStore>((set, get) => ({
  pendingNavigation: null,

  setPendingNavigation: (request) => {
    set({ pendingNavigation: request });
  },

  consumePendingNavigation: (threadId) => {
    const current = get().pendingNavigation;
    if (!current || current.threadId !== threadId) {
      return null;
    }
    set({ pendingNavigation: null });
    return current;
  },

  clearPendingNavigation: () => {
    if (get().pendingNavigation === null) {
      return;
    }
    set({ pendingNavigation: null });
  },
}));
