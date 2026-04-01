import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

interface BranchSelectorFocusRequest {
  requestId: number;
  threadId: ThreadId;
}

interface ChatToolbarFocusStore {
  branchSelectorFocusRequest: BranchSelectorFocusRequest | null;
  requestBranchSelectorFocus: (threadId: ThreadId) => void;
  clearBranchSelectorFocusRequest: () => void;
}

export const useChatToolbarFocusStore = create<ChatToolbarFocusStore>((set) => ({
  branchSelectorFocusRequest: null,
  requestBranchSelectorFocus: (threadId) =>
    set((state) => ({
      branchSelectorFocusRequest: {
        requestId: (state.branchSelectorFocusRequest?.requestId ?? 0) + 1,
        threadId,
      },
    })),
  clearBranchSelectorFocusRequest: () => set({ branchSelectorFocusRequest: null }),
}));
