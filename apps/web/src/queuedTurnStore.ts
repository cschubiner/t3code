import {
  ModelSelection,
  OrchestrationSessionStatus,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { LocalDispatchSnapshotSchema, type LocalDispatchSnapshot } from "./localDispatch";
import type { SessionPhase } from "./types";
import { createDebouncedStorage, getIsomorphicStorage } from "./lib/storage";

export const QUEUED_TURN_STORE_STORAGE_KEY = "t3code:queued-turn-store:v1";
const QUEUED_TURN_STORE_STORAGE_VERSION = 2;
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

export type QueuedTurnDispatchBlockReason = "connecting" | "running" | "local-dispatch";

export interface QueuedTurnDispatchGate {
  canDispatch: boolean;
  pauseReason: QueuedTurnPauseReason | null;
  blockReason: QueuedTurnDispatchBlockReason | null;
}

export interface QueuedTurnDispatchGateInput {
  phase: SessionPhase;
  sessionOrchestrationStatus: typeof OrchestrationSessionStatus.Type | null | undefined;
  hasActiveUnsettledTurn: boolean;
  isLocalDispatchInFlight: boolean;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
}

export interface QueuedTurnAutoPauseInput {
  sessionOrchestrationStatus: typeof OrchestrationSessionStatus.Type | null | undefined;
  hasActiveUnsettledTurn: boolean;
}

export function deriveQueuedTurnDispatchGate(
  input: QueuedTurnDispatchGateInput,
): QueuedTurnDispatchGate {
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

  if (input.phase === "connecting" || input.sessionOrchestrationStatus === "starting") {
    return {
      canDispatch: false,
      pauseReason: null,
      blockReason: "connecting",
    };
  }

  if (
    input.phase === "running" ||
    input.sessionOrchestrationStatus === "running" ||
    input.hasActiveUnsettledTurn
  ) {
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

export function deriveQueuedTurnAutoPauseReason(
  input: QueuedTurnAutoPauseInput,
): QueuedTurnPauseReason | null {
  if (input.sessionOrchestrationStatus === "error" && !input.hasActiveUnsettledTurn) {
    return "session-error";
  }

  return null;
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

export type QueuedTurnDispatchStatus = "idle" | "dispatching" | "awaiting-ack";
export const QueuedTurnDispatchStatusSchema = Schema.Literals([
  "idle",
  "dispatching",
  "awaiting-ack",
]);

export interface QueuedTurnRuntimeDispatchState {
  status: QueuedTurnDispatchStatus;
  queuedTurnId: string | null;
  localDispatch: LocalDispatchSnapshot | null;
}

export const PersistedQueuedTurnDispatchStateSchema = Schema.Struct({
  status: QueuedTurnDispatchStatusSchema,
  queuedTurnId: Schema.NullOr(Schema.String),
  localDispatch: Schema.NullOr(LocalDispatchSnapshotSchema),
});
export type PersistedQueuedTurnDispatchState = typeof PersistedQueuedTurnDispatchStateSchema.Type;

export const IDLE_QUEUED_TURN_DISPATCH_STATE: QueuedTurnRuntimeDispatchState = {
  status: "idle",
  queuedTurnId: null,
  localDispatch: null,
};

export const PersistedThreadQueuedTurnStateSchema = Schema.Struct({
  items: Schema.Array(QueuedTurnDraft),
  pauseReason: Schema.NullOr(QueuedTurnPauseReason),
  updatedAt: Schema.NullOr(Schema.String),
  dispatch: PersistedQueuedTurnDispatchStateSchema,
});
export type PersistedThreadQueuedTurnState = typeof PersistedThreadQueuedTurnStateSchema.Type;

const LegacyPersistedThreadQueuedTurnStateSchema = Schema.Struct({
  items: Schema.Array(QueuedTurnDraft),
  pauseReason: Schema.NullOr(QueuedTurnPauseReason),
  updatedAt: Schema.NullOr(Schema.String),
});
type LegacyPersistedThreadQueuedTurnState = typeof LegacyPersistedThreadQueuedTurnStateSchema.Type;

export function getQueuedTurnDispatchState(
  state: Pick<ThreadQueuedTurnState, "dispatch"> | null | undefined,
): QueuedTurnRuntimeDispatchState {
  return state?.dispatch ?? IDLE_QUEUED_TURN_DISPATCH_STATE;
}

export interface ThreadQueuedTurnState extends PersistedThreadQueuedTurnState {
  dispatch: QueuedTurnRuntimeDispatchState;
}

export const QueuedTurnStorePersistedStateSchema = Schema.Struct({
  threadsByThreadId: Schema.Record(ThreadId, PersistedThreadQueuedTurnStateSchema),
});

const LegacyQueuedTurnStorePersistedStateSchema = Schema.Struct({
  threadsByThreadId: Schema.Record(ThreadId, LegacyPersistedThreadQueuedTurnStateSchema),
});

export interface QueuedTurnStoreStateShape {
  threadsByThreadId: Record<ThreadId, ThreadQueuedTurnState>;
}

export const QueuedTurnStoreStorageSchema = Schema.Struct({
  version: Schema.Number,
  state: QueuedTurnStorePersistedStateSchema,
});

export const LegacyQueuedTurnStoreStorageSchema = Schema.Struct({
  version: Schema.Number,
  state: LegacyQueuedTurnStorePersistedStateSchema,
});

const EMPTY_QUEUED_TURN_STORE_STATE: QueuedTurnStoreStateShape = {
  threadsByThreadId: {},
};

function createThreadQueuedTurnState(
  input?: Partial<PersistedThreadQueuedTurnState>,
): ThreadQueuedTurnState {
  return {
    items: input?.items ?? [],
    pauseReason: input?.pauseReason ?? null,
    updatedAt: input?.updatedAt ?? null,
    dispatch: input?.dispatch ?? IDLE_QUEUED_TURN_DISPATCH_STATE,
  };
}

function migratePersistedThreadQueuedTurnState(
  state: PersistedThreadQueuedTurnState | LegacyPersistedThreadQueuedTurnState,
): PersistedThreadQueuedTurnState {
  return {
    items: state.items,
    pauseReason: state.pauseReason,
    updatedAt: state.updatedAt,
    dispatch: "dispatch" in state ? state.dispatch : IDLE_QUEUED_TURN_DISPATCH_STATE,
  };
}

function cleanupThreadQueueState(
  state: ThreadQueuedTurnState | null,
): ThreadQueuedTurnState | null {
  if (!state) {
    return null;
  }
  if (
    state.items.length === 0 &&
    state.pauseReason === null &&
    getQueuedTurnDispatchState(state).status === "idle"
  ) {
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
  getDispatchState: (threadId: ThreadId) => QueuedTurnRuntimeDispatchState;
  enqueueTurn: (threadId: ThreadId, turn: QueuedTurnDraft) => void;
  replaceQueuedTurn: (threadId: ThreadId, turnId: string, nextTurn: QueuedTurnDraft) => void;
  removeQueuedTurn: (threadId: ThreadId, turnId: string) => void;
  moveQueuedTurn: (threadId: ThreadId, turnId: string, nextIndex: number) => void;
  dequeueNextTurn: (threadId: ThreadId) => QueuedTurnDraft | null;
  beginDispatch: (
    threadId: ThreadId,
    queuedTurnId: string,
    localDispatch: LocalDispatchSnapshot,
  ) => void;
  markDispatchAwaitingAck: (
    threadId: ThreadId,
    queuedTurnId: string,
    localDispatch: LocalDispatchSnapshot,
  ) => void;
  acknowledgeDispatch: (
    threadId: ThreadId,
    queuedTurnId: string,
    updatedAt?: string | null,
  ) => void;
  resetDispatch: (threadId: ThreadId) => void;
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

      getDispatchState: (threadId) => getQueuedTurnDispatchState(get().threadsByThreadId[threadId]),

      enqueueTurn: (threadId, turn) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => ({
            items: [...(current?.items ?? []), turn],
            pauseReason: current?.pauseReason ?? null,
            updatedAt: turn.updatedAt,
            dispatch: getQueuedTurnDispatchState(current),
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

      beginDispatch: (threadId, queuedTurnId, localDispatch) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => ({
            ...(current ?? createThreadQueuedTurnState()),
            dispatch: {
              status: "dispatching",
              queuedTurnId,
              localDispatch,
            },
          })),
        );
      },

      markDispatchAwaitingAck: (threadId, queuedTurnId, localDispatch) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => {
            if (!current) {
              return null;
            }
            return {
              ...current,
              dispatch: {
                status: "awaiting-ack",
                queuedTurnId,
                localDispatch,
              },
            };
          }),
        );
      },

      acknowledgeDispatch: (threadId, queuedTurnId, updatedAt = null) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => {
            if (!current) {
              return null;
            }
            return {
              ...current,
              items: current.items.filter((item) => item.id !== queuedTurnId),
              updatedAt,
              dispatch: IDLE_QUEUED_TURN_DISPATCH_STATE,
            };
          }),
        );
      },

      resetDispatch: (threadId) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => {
            if (!current) {
              return null;
            }
            return {
              ...current,
              dispatch: IDLE_QUEUED_TURN_DISPATCH_STATE,
            };
          }),
        );
      },

      pauseThreadQueue: (threadId, reason, updatedAt = null) => {
        set((state) =>
          withThreadQueueState(state, threadId, (current) => ({
            items: current?.items ?? [],
            pauseReason: reason,
            updatedAt,
            dispatch: getQueuedTurnDispatchState(current),
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
        threadsByThreadId: Object.fromEntries(
          Object.entries(state.threadsByThreadId).map(([threadId, threadState]) => [
            threadId,
            {
              items: threadState.items,
              pauseReason: threadState.pauseReason,
              updatedAt: threadState.updatedAt,
              dispatch: threadState.dispatch,
            } satisfies PersistedThreadQueuedTurnState,
          ]),
        ) as Record<ThreadId, PersistedThreadQueuedTurnState>,
      }),
      migrate: (persistedState, version) => {
        const nextState =
          typeof persistedState === "object" && persistedState !== null
            ? (persistedState as Partial<
                | QueuedTurnStoreStateShape
                | { threadsByThreadId: Record<ThreadId, LegacyPersistedThreadQueuedTurnState> }
              >)
            : null;

        if (!nextState?.threadsByThreadId) {
          return EMPTY_QUEUED_TURN_STORE_STATE;
        }

        if (version >= 2) {
          return {
            threadsByThreadId: Object.fromEntries(
              Object.entries(nextState.threadsByThreadId).map(([threadId, threadState]) => [
                threadId,
                migratePersistedThreadQueuedTurnState(
                  threadState as PersistedThreadQueuedTurnState,
                ),
              ]),
            ) as Record<ThreadId, PersistedThreadQueuedTurnState>,
          };
        }

        return {
          threadsByThreadId: Object.fromEntries(
            Object.entries(nextState.threadsByThreadId).map(([threadId, threadState]) => [
              threadId,
              migratePersistedThreadQueuedTurnState(
                threadState as LegacyPersistedThreadQueuedTurnState,
              ),
            ]),
          ) as Record<ThreadId, PersistedThreadQueuedTurnState>,
        };
      },
      merge: (persistedState, currentState) => {
        const nextState =
          typeof persistedState === "object" && persistedState !== null
            ? (persistedState as Partial<{
                threadsByThreadId: Record<ThreadId, PersistedThreadQueuedTurnState>;
              }>)
            : null;
        return {
          ...currentState,
          threadsByThreadId: nextState?.threadsByThreadId
            ? (Object.fromEntries(
                Object.entries(nextState.threadsByThreadId).map(([threadId, threadState]) => [
                  threadId,
                  createThreadQueuedTurnState(threadState),
                ]),
              ) as Record<ThreadId, ThreadQueuedTurnState>)
            : currentState.threadsByThreadId,
        };
      },
    },
  ),
);

export function flushQueuedTurnStoreStorage(): void {
  queuedTurnDebouncedStorage.flush();
}

export function useQueuedTurnStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useQueuedTurnStore.persist.hasHydrated());

  useEffect(() => {
    setHydrated(useQueuedTurnStore.persist.hasHydrated());

    const unsubscribeHydrate = useQueuedTurnStore.persist.onHydrate(() => {
      setHydrated(false);
    });
    const unsubscribeFinishHydration = useQueuedTurnStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });

    return () => {
      unsubscribeHydrate();
      unsubscribeFinishHydration();
    };
  }, []);

  return hydrated;
}
