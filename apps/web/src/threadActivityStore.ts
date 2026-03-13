import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

interface ThreadActivityStore {
  transientWorkByThreadId: Partial<Record<ThreadId, true>>;
  setTransientWorking: (threadId: ThreadId, isWorking: boolean) => void;
}

export const useThreadActivityStore = create<ThreadActivityStore>((set) => ({
  transientWorkByThreadId: {},
  setTransientWorking: (threadId, isWorking) =>
    set((state) => {
      if (isWorking) {
        if (state.transientWorkByThreadId[threadId]) {
          return state;
        }
        return {
          transientWorkByThreadId: {
            ...state.transientWorkByThreadId,
            [threadId]: true,
          },
        };
      }

      if (!state.transientWorkByThreadId[threadId]) {
        return state;
      }

      const nextTransientWorkByThreadId = { ...state.transientWorkByThreadId };
      delete nextTransientWorkByThreadId[threadId];
      return { transientWorkByThreadId: nextTransientWorkByThreadId };
    }),
}));
