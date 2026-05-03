import { ThreadId } from "@t3tools/contracts";

export function resolveThreadDeletionNavigationTarget(input: {
  deletedThreadId: ThreadId;
  orderedThreadIds: readonly ThreadId[];
  deletedThreadIds?: ReadonlySet<ThreadId> | undefined;
}): ThreadId | null {
  const { deletedThreadId, orderedThreadIds, deletedThreadIds } = input;
  const deletedIds = deletedThreadIds ?? new Set<ThreadId>([deletedThreadId]);
  const currentIndex = orderedThreadIds.indexOf(deletedThreadId);

  if (currentIndex === -1) {
    return orderedThreadIds.find((threadId) => !deletedIds.has(threadId)) ?? null;
  }

  for (let index = currentIndex + 1; index < orderedThreadIds.length; index += 1) {
    const candidateThreadId = orderedThreadIds[index];
    if (candidateThreadId && !deletedIds.has(candidateThreadId)) {
      return candidateThreadId;
    }
  }

  return null;
}
