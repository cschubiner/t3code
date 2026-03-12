import { type ProjectId, type ThreadId } from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import { readNativeApi } from "../nativeApi";
import type { Project, Thread } from "../types";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { newCommandId } from "./utils";

interface DeleteThreadWithSidebarBehaviorInput {
  threadId: ThreadId;
  threads: readonly Thread[];
  projects: readonly Project[];
  routeThreadId: ThreadId | null;
  deletedThreadIds?: ReadonlySet<ThreadId> | undefined;
  clearComposerDraftForThread: (threadId: ThreadId) => void;
  clearProjectDraftThreadById: (projectId: ProjectId, threadId: ThreadId) => void;
  clearTerminalState: (threadId: ThreadId) => void;
  navigateToThread: (threadId: ThreadId | null) => void;
  removeWorktree: (input: { cwd: string; path: string; force: true }) => Promise<void>;
}

export type DeleteThreadResult = "deleted" | "cancelled" | "missing" | "unavailable";

function findThread(threads: readonly Thread[], threadId: ThreadId): Thread | null {
  return threads.find((thread) => thread.id === threadId) ?? null;
}

async function confirmThreadDeletion(thread: Thread): Promise<boolean | null> {
  const api = readNativeApi();
  if (!api) {
    return null;
  }
  return api.dialogs.confirm(
    [
      `Delete thread "${thread.title}"?`,
      "This permanently clears conversation history for this thread.",
    ].join("\n"),
  );
}

export async function deleteThreadWithSidebarBehavior(
  input: DeleteThreadWithSidebarBehaviorInput,
): Promise<DeleteThreadResult> {
  const api = readNativeApi();
  if (!api) {
    return "unavailable";
  }

  const thread = findThread(input.threads, input.threadId);
  if (!thread) {
    return "missing";
  }

  const threadProject = input.projects.find((project) => project.id === thread.projectId);
  const deletedIds = input.deletedThreadIds;
  const survivingThreads =
    deletedIds && deletedIds.size > 0
      ? input.threads.filter((entry) => entry.id === input.threadId || !deletedIds.has(entry.id))
      : input.threads;
  const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, input.threadId);
  const displayWorktreePath = orphanedWorktreePath
    ? formatWorktreePathForDisplay(orphanedWorktreePath)
    : null;
  const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
  const shouldDeleteWorktree =
    canDeleteWorktree &&
    (await api.dialogs.confirm(
      [
        "This thread is the only one linked to this worktree:",
        displayWorktreePath ?? orphanedWorktreePath,
        "",
        "Delete the worktree too?",
      ].join("\n"),
    ));

  if (thread.session && thread.session.status !== "closed") {
    await api.orchestration
      .dispatchCommand({
        type: "thread.session.stop",
        commandId: newCommandId(),
        threadId: input.threadId,
        createdAt: new Date().toISOString(),
      })
      .catch(() => undefined);
  }

  try {
    await api.terminal.close({ threadId: input.threadId, deleteHistory: true });
  } catch {
    // Terminal may already be closed.
  }

  const allDeletedIds = deletedIds ?? new Set<ThreadId>();
  const shouldNavigateToFallback = input.routeThreadId === input.threadId;
  const fallbackThreadId =
    input.threads.find((entry) => entry.id !== input.threadId && !allDeletedIds.has(entry.id))
      ?.id ?? null;

  await api.orchestration.dispatchCommand({
    type: "thread.delete",
    commandId: newCommandId(),
    threadId: input.threadId,
  });

  input.clearComposerDraftForThread(input.threadId);
  input.clearProjectDraftThreadById(thread.projectId, thread.id);
  input.clearTerminalState(input.threadId);

  if (shouldNavigateToFallback) {
    input.navigateToThread(fallbackThreadId);
  }

  if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
    return "deleted";
  }

  try {
    await input.removeWorktree({
      cwd: threadProject.cwd,
      path: orphanedWorktreePath,
      force: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
    console.error("Failed to remove orphaned worktree after thread deletion", {
      threadId: input.threadId,
      projectCwd: threadProject.cwd,
      worktreePath: orphanedWorktreePath,
      error,
    });
    toastManager.add({
      type: "error",
      title: "Thread deleted, but worktree removal failed",
      description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
    });
  }

  return "deleted";
}

export async function confirmAndDeleteThreadWithSidebarBehavior(
  input: DeleteThreadWithSidebarBehaviorInput & { confirmBeforeDelete: boolean },
): Promise<DeleteThreadResult> {
  const thread = findThread(input.threads, input.threadId);
  if (!thread) {
    return "missing";
  }

  if (input.confirmBeforeDelete) {
    const confirmed = await confirmThreadDeletion(thread);
    if (confirmed === null) {
      return "unavailable";
    }
    if (!confirmed) {
      return "cancelled";
    }
  }

  return deleteThreadWithSidebarBehavior(input);
}
