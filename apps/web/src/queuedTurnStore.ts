import {
  ModelSelection,
  OrchestrationSessionStatus,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { SessionPhase } from "./types";
import { createDebouncedStorage, getIsomorphicStorage } from "./lib/storage";

export const QUEUED_TURN_STORE_STORAGE_KEY = "t3code:queued-turn-store:v1";
const QUEUED_TURN_STORE_STORAGE_VERSION = 1;
const QUEUED_TURN_STORE_PERSIST_DEBOUNCE_MS = 300;

const queuedTurnDebouncedStorage = createDebouncedStorage(
  getIsomorphicStorage(),
  QUEUED_TURN_STORE_PERSIST_DEBOUNCE_MS,
);

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    queuedTurnDebouncedStorage.flush();
  });
}

export const QueuedTurnPauseReason = Schema.Literals([
  "thread-error",
  "session-error",
  "session-interrupted",
  "pending-approval",
  "pending-user-input",
]);
export type QueuedTurnPauseReason = typeof QueuedTurnPauseReason.Type;

export type QueuedTurnDispatchBlockReason =
  | "disconnected"
  | "connecting"
  | "running"
  | "local-dispatch";

export interface QueuedTurnDispatchGate {
  canDispatch: boolean;
  pauseReason: QueuedTurnPauseReason | null;
  blockReason: QueuedTurnDispatchBlockReason | null;
}

export interface QueuedTurnDispatchGateInput {
  phase: SessionPhase;
  sessionOrchestrationStatus: typeof OrchestrationSessionStatus.Type | null | undefined;
  isLocalDispatchInFlight: boolean;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  threadError: string | null | undefined;
}

export function deriveQueuedTurnDispatchGate(
  input: QueuedTurnDispatchGateInput,
): QueuedTurnDispatchGate {
  if (typeof input.threadError === "string" && input.threadError.trim().length > 0) {
    return {
      canDispatch: false,
      pauseReason: "thread-error",
      blockReason: null,
    };
  }

  if (input.sessionOrchestrationStatus === "error") {
    return {
      canDispatch: false,
      pauseReason: "session-error",
      blockReason: null,
    };
  }

  if (input.sessionOrchestrationStatus === "interrupted") {
    return {
      canDispatch: false,
      pauseReason: "session-interrupted",
      blockReason: null,
    };
  }

  if (input.hasPendingApproval) {
    return {
      canDispatch: false,
      pauseReason: "pending-approval",
      blockReason: null,
    };
  }

  if (input.hasPendingUserInput) {
    return {
      canDispatch: false,
      pauseReason: "pending-user-input",
      blockReason: null,
    };
  }

  if (input.phase === "disconnected") {
    return {
      canDispatch: false,
      pauseReason: null,
      blockReason: "disconnected",
    };
  }

  if (input.phase === "connecting" || input.sessionOrchestrationStatus === "starting") {
    return {
      canDispatch: false,
      pauseReason: null,
      blockReason: "connecting",
    };
  }

  if (input.phase === "running" || input.sessionOrchestrationStatus === "running") {
    return {
      canDispatch: false,
      pauseReason: null,
      blockReason: "running",
    };
  }

  if (input.isLocalDispatchInFlight) {
    return {
      canDispatch: false,
      pauseReason: null,
      blockReason: "local-dispatch",
    };
  }

  return {
    canDispatch: true,
    pauseReason: null,
    blockReason: null,
  };
}

export const QueuedTurnAttachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  dataUrl: Schema.String,
});
export type QueuedTurnAttachment = typeof QueuedTurnAttachment.Type;

export const QueuedTurnTerminalContext = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  terminalId: Schema.String,
  terminalLabel: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
  text: Schema.String,
  createdAt: Schema.String,
});
export type QueuedTurnTerminalContext = typeof QueuedTurnTerminalContext.Type;

export const QueuedTurnDraft = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  attachments: Schema.Array(QueuedTurnAttachment),
  terminalContexts: Schema.Array(QueuedTurnTerminalContext),
  modelSelection: Schema.NullOr(ModelSelection),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type QueuedTurnDraft = typeof QueuedTurnDraft.Type;

export const ThreadQueuedTurnState = Schema.Struct({
  items: Schema.Array(QueuedTurnDraft),
  pauseReason: Schema.NullOr(QueuedTurnPauseReason),
  updatedAt: Schema.NullOr(Schema.String),
});
export type ThreadQueuedTurnState = typeof ThreadQueuedTurnState.Type;

export const QueuedTurnStoreStateSchema = Schema.Struct({
  threadsByThreadId: Schema.Record(ThreadId, ThreadQueuedTurnState),
});
export type QueuedTurnStoreStateShape = typeof QueuedTurnStoreStateSchema.Type;

export const QueuedTurnStoreStorageSchema = Schema.Struct({
  version: Schema.Number,
  state: QueuedTurnStoreStateSchema,
});

const EMPTY_QUEUED_TURN_STORE_STATE: QueuedTurnStoreStateShape = {
  threadsByThreadId: {},
};

function cleanupThreadQueueState(
  state: ThreadQueuedTurnState | null,
): ThreadQueuedTurnState | null {
  if (!state) {
    return null;
  }
  if (state.items.length === 0 && state.pauseReason === null) {
    return null;
  }
  return state;
}

function withThreadQueueState(
  state: QueuedTurnStoreStateShape,
  threadId: ThreadId,
  updater: (current: ThreadQueuedTurnState | null) => ThreadQueuedTurnState | null,
): QueuedTurnStoreStateShape {
  const current = state.threadsByThreadId[threadId] ?? null;
  const next = cleanupThreadQueueState(updater(current));
  if (next === null) {
    if (!(threadId in state.threadsByThreadId)) {
      return state;
    }
    const { [threadId]: _discarded, ...rest } = state.threadsByThreadId;
    return {
      threadsByThreadId: rest,
    };
  }
  return {
    threadsByThreadId: {
      ...state.threadsByThreadId,
      [threadId]: next,
    },
  };
}

function clampMoveIndex(length: number, index: number): number {
  if (!Number.isFinite(index)) {
    return Math.max(0, length - 1);
  }
  return Math.max(0, Math.min(length - 1, Math.floor(index)));
}

export interface QueuedTurnStore extends QueuedTurnStoreStateShape {
  getThreadQueue: (threadId: ThreadId) => ThreadQueuedTurnState | null;
  getQueuedTurns: (threadId: ThreadId) => readonly QueuedTurnDraft[];
  enqueueTurn: (threadId: ThreadId, turn: QueuedTurnDraft) => void;
  replaceQueuedTurn: (threadId: ThreadId, turnId: string, nextTurn: QueuedTurnDraft) => void;
  removeQueuedTurn: (threadId: ThreadId, turnId: string) => void;
  moveQueuedTurn: (threadId: ThreadId, turnId: string, nextIndex: number) => void;
  dequeueNextTurn: (threadId: ThreadId) => QueuedTurnDraft | null;
  pauseThreadQueue: (
    threadId: ThreadId,
    reason: QueuedTurnPauseReason,
    updatedAt?: string | null,
  ) => void;
  resumeThreadQueue: (threadId: ThreadId, updatedAt?: string | null) => void;
  clearThreadQueue: (threadId: ThreadId) => void;
}

export const useQueuedTurnStore = create<QueuedTurnStore>()(
  persist(
    (set, get) => ({
      ...EMPTY_QUEUED_TURN_STORE_STATE,

      getThreadQueue: (threadId) => get().threadsByThreadId[threadId] ?? null,

      getQueuedTurns: (threadId) => get().threadsByThreadId[threadId]?.items ?? [],

      enqueueTurn: (threadId, turn) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => ({
            items: [...(current?.items ?? []), turn],
            pauseReason: current?.pauseReason ?? null,
            updatedAt: turn.updatedAt,
          })),
        );
      },

      replaceQueuedTurn: (threadId, turnId, nextTurn) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => {
            if (!current) {
              return null;
            }
            let replaced = false;
            const nextItems = current.items.map((item) => {
              if (item.id !== turnId) {
                return item;
              }
              replaced = true;
              return nextTurn;
            });
            if (!replaced) {
              return current;
            }
            return {
              ...current,
              items: nextItems,
              updatedAt: nextTurn.updatedAt,
            };
          }),
        );
      },

      removeQueuedTurn: (threadId, turnId) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => {
            if (!current) {
              return null;
            }
            const nextItems = current.items.filter((item) => item.id !== turnId);
            if (nextItems.length === current.items.length) {
              return current;
            }
            return {
              ...current,
              items: nextItems,
            };
          }),
        );
      },

      moveQueuedTurn: (threadId, turnId, nextIndex) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => {
            if (!current || current.items.length < 2) {
              return current;
            }
            const currentIndex = current.items.findIndex((item) => item.id === turnId);
            if (currentIndex < 0) {
              return current;
            }
            const targetIndex = clampMoveIndex(current.items.length, nextIndex);
            if (targetIndex === currentIndex) {
              return current;
            }
            const nextItems = [...current.items];
            const [movedItem] = nextItems.splice(currentIndex, 1);
            if (!movedItem) {
              return current;
            }
            nextItems.splice(targetIndex, 0, movedItem);
            return {
              ...current,
              items: nextItems,
              updatedAt: movedItem.updatedAt,
            };
          }),
        );
      },

      dequeueNextTurn: (threadId) => {
        const nextTurn = get().threadsByThreadId[threadId]?.items[0] ?? null;
        if (!nextTurn) {
          return null;
        }
        set((state) =>
          withThreadQueueState(state, threadId, (current) =>
            current
              ? {
                  ...current,
                  items: current.items.slice(1),
                }
              : null,
          ),
        );
        return nextTurn;
      },

      pauseThreadQueue: (threadId, reason, updatedAt = null) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => ({
            items: current?.items ?? [],
            pauseReason: reason,
            updatedAt,
          })),
        );
      },

      resumeThreadQueue: (threadId, updatedAt = null) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => {
            if (!current) {
              return null;
            }
            return {
              ...current,
              pauseReason: null,
              updatedAt,
            };
          }),
        );
      },

      clearThreadQueue: (threadId) => {
        set((state) => withThreadQueueState(state, threadId, () => null));
      },
    }),
    {
      name: QUEUED_TURN_STORE_STORAGE_KEY,
      version: QUEUED_TURN_STORE_STORAGE_VERSION,
      storage: createJSONStorage(() => queuedTurnDebouncedStorage),
      partialize: (state) => ({
        threadsByThreadId: state.threadsByThreadId,
      }),
      merge: (persistedState, currentState) => {
        const nextState =
          typeof persistedState === "object" && persistedState !== null
            ? (persistedState as Partial<QueuedTurnStoreStateShape>)
            : null;
        return {
          ...currentState,
          threadsByThreadId: nextState?.threadsByThreadId ?? currentState.threadsByThreadId,
        };
      },
    },
  ),
);

export function flushQueuedTurnStoreStorage(): void {
  queuedTurnDebouncedStorage.flush();
}
