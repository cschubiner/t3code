import type { SidebarThreadSummary } from "../types";

function threadRecentSortTimestamp(
  thread: Pick<SidebarThreadSummary, "createdAt" | "updatedAt">,
): number {
  return Date.parse(thread.updatedAt ?? thread.createdAt) || Number.NEGATIVE_INFINITY;
}

export function sortThreadsForRecentSidebar<
  T extends Pick<SidebarThreadSummary, "id" | "createdAt" | "updatedAt">,
>(threads: readonly T[]): T[] {
  return threads.toSorted((left, right) => {
    const byUpdatedAt = threadRecentSortTimestamp(right) - threadRecentSortTimestamp(left);
    if (byUpdatedAt !== 0) return byUpdatedAt;

    const byCreatedAt = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;

    return right.id.localeCompare(left.id);
  });
}
