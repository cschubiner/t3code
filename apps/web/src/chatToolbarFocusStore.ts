import { create } from "zustand";

interface ChatToolbarFocusStore {
  branchSelectorFocusRequestId: number;
  requestBranchSelectorFocus: () => void;
}

export const useChatToolbarFocusStore = create<ChatToolbarFocusStore>((set) => ({
  branchSelectorFocusRequestId: 0,
  requestBranchSelectorFocus: () =>
    set((state) => ({
      branchSelectorFocusRequestId: state.branchSelectorFocusRequestId + 1,
    })),
}));
