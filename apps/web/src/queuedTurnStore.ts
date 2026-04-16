/**
 * Queued-turn store — per-thread FIFO of pending follow-up messages.
 *
 * Users can queue a message while the current turn is still in-flight; the
 * background dispatcher (see QueuedTurnBackgroundDispatcher) pops the next
 * item once the thread is idle and routes it back through the same
 * dispatch pipeline the composer uses.
 *
 * Keyed by `scopedThreadKey` (environmentId + threadId) so each thread
 * has its own queue and queues don't leak across environments.
 *
 * Only queue text + queue order is persisted to localStorage — attachments
 * and terminal contexts are per-session ephemera today and will require
 * contract work to persist safely.
 */
import { scopedThreadKey } from "@t3tools/client-runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDebouncedStorage, createMemoryStorage } from "./lib/storage";

const QUEUED_TURN_STORE_STORAGE_KEY = "t3code:queued-turn-store:v1";
const QUEUED_TURN_STORE_STORAGE_VERSION = 1;
const QUEUED_TURN_STORE_PERSIST_DEBOUNCE_MS = 300;

const queuedTurnDebouncedStorage = createDebouncedStorage(
  typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
  QUEUED_TURN_STORE_PERSIST_DEBOUNCE_MS,
);

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    queuedTurnDebouncedStorage.flush();
  });
}

export const QueuedTurnDraftSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  createdAt: Schema.String,
});
export type QueuedTurnDraft = typeof QueuedTurnDraftSchema.Type;

export const PersistedThreadQueueSchema = Schema.Struct({
  items: Schema.Array(QueuedTurnDraftSchema),
  updatedAt: Schema.NullOr(Schema.String),
});
export type PersistedThreadQueue = typeof PersistedThreadQueueSchema.Type;

const PersistedQueueStateSchema = Schema.Struct({
  threadsByThreadKey: Schema.Record(Schema.String, PersistedThreadQueueSchema),
});

export interface ThreadQueueState extends PersistedThreadQueue {}

export interface QueuedTurnStoreState {
  threadsByThreadKey: Record<string, ThreadQueueState>;
}

export interface QueuedTurnStore extends QueuedTurnStoreState {
  getQueue: (threadRef: ScopedThreadRef) => readonly QueuedTurnDraft[];
  enqueue: (threadRef: ScopedThreadRef, text: string) => QueuedTurnDraft | null;
  removeById: (threadRef: ScopedThreadRef, id: string) => void;
  popNext: (threadRef: ScopedThreadRef) => QueuedTurnDraft | null;
  replaceText: (threadRef: ScopedThreadRef, id: string, text: string) => void;
  moveToIndex: (threadRef: ScopedThreadRef, id: string, nextIndex: number) => void;
  clearThread: (threadRef: ScopedThreadRef) => void;
}

function nextQueueId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `queued-turn-${crypto.randomUUID()}`;
  }
  return `queued-turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampMoveIndex(length: number, index: number): number {
  if (!Number.isFinite(index)) return Math.max(0, length - 1);
  return Math.max(0, Math.min(length - 1, Math.floor(index)));
}

function updateQueue(
  state: QueuedTurnStoreState,
  key: string,
  updater: (queue: ThreadQueueState | null) => ThreadQueueState | null,
): QueuedTurnStoreState {
  const current = state.threadsByThreadKey[key] ?? null;
  const next = updater(current);
  if (next === null || next.items.length === 0) {
    if (!(key in state.threadsByThreadKey)) return state;
    const { [key]: _dropped, ...rest } = state.threadsByThreadKey;
    return { threadsByThreadKey: rest };
  }
  return {
    threadsByThreadKey: { ...state.threadsByThreadKey, [key]: next },
  };
}

export const useQueuedTurnStore = create<QueuedTurnStore>()(
  persist(
    (set, get) => ({
      threadsByThreadKey: {},

      getQueue: (ref) => {
        const key = scopedThreadKey(ref);
        return get().threadsByThreadKey[key]?.items ?? [];
      },

      enqueue: (ref, text) => {
        const trimmed = text.trim();
        if (trimmed.length === 0) return null;
        const draft: QueuedTurnDraft = {
          id: nextQueueId(),
          text: trimmed,
          createdAt: new Date().toISOString(),
        };
        const key = scopedThreadKey(ref);
        set((state) =>
          updateQueue(state, key, (current) => ({
            items: [...(current?.items ?? []), draft],
            updatedAt: draft.createdAt,
          })),
        );
        return draft;
      },

      removeById: (ref, id) => {
        const key = scopedThreadKey(ref);
        set((state) =>
          updateQueue(state, key, (current) => {
            if (!current) return null;
            const nextItems = current.items.filter((item) => item.id !== id);
            if (nextItems.length === current.items.length) return current;
            return { items: nextItems, updatedAt: new Date().toISOString() };
          }),
        );
      },

      popNext: (ref) => {
        const key = scopedThreadKey(ref);
        const head = get().threadsByThreadKey[key]?.items[0] ?? null;
        if (!head) return null;
        set((state) =>
          updateQueue(state, key, (current) =>
            current
              ? {
                  items: current.items.slice(1),
                  updatedAt: new Date().toISOString(),
                }
              : null,
          ),
        );
        return head;
      },

      replaceText: (ref, id, text) => {
        const trimmed = text.trim();
        if (trimmed.length === 0) {
          get().removeById(ref, id);
          return;
        }
        const key = scopedThreadKey(ref);
        set((state) =>
          updateQueue(state, key, (current) => {
            if (!current) return null;
            let changed = false;
            const nextItems = current.items.map((item) => {
              if (item.id !== id) return item;
              if (item.text === trimmed) return item;
              changed = true;
              return { ...item, text: trimmed };
            });
            if (!changed) return current;
            return { items: nextItems, updatedAt: new Date().toISOString() };
          }),
        );
      },

      moveToIndex: (ref, id, nextIndex) => {
        const key = scopedThreadKey(ref);
        set((state) =>
          updateQueue(state, key, (current) => {
            if (!current || current.items.length < 2) return current;
            const currentIndex = current.items.findIndex((item) => item.id === id);
            if (currentIndex < 0) return current;
            const targetIndex = clampMoveIndex(current.items.length, nextIndex);
            if (targetIndex === currentIndex) return current;
            const nextItems = [...current.items];
            const [moved] = nextItems.splice(currentIndex, 1);
            if (!moved) return current;
            nextItems.splice(targetIndex, 0, moved);
            return { items: nextItems, updatedAt: new Date().toISOString() };
          }),
        );
      },

      clearThread: (ref) => {
        const key = scopedThreadKey(ref);
        set((state) => updateQueue(state, key, () => null));
      },
    }),
    {
      name: QUEUED_TURN_STORE_STORAGE_KEY,
      version: QUEUED_TURN_STORE_STORAGE_VERSION,
      storage: createJSONStorage(() => queuedTurnDebouncedStorage),
      partialize: (state) => ({
        threadsByThreadKey: state.threadsByThreadKey,
      }),
    },
  ),
);

export function flushQueuedTurnStoreStorage(): void {
  queuedTurnDebouncedStorage.flush();
}

export type { ScopedThreadRef };
export { PersistedQueueStateSchema };
