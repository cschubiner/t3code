import type { ThreadId } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import {
  QUICK_THREAD_SEARCH_RECENT_LIMIT,
  buildQuickThreadSearchIndex,
  buildQuickThreadSearchResults,
} from "../lib/quickThreadSearch";
import { useStore } from "../store";
import { ThreadSearchDialog } from "./ThreadSearchDialog";

interface QuickThreadSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeThreadId: ThreadId | null;
  focusRequestId: number;
}

export function QuickThreadSearchDialog({
  open,
  onOpenChange,
  activeThreadId,
  focusRequestId,
}: QuickThreadSearchDialogProps) {
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const index = useMemo(
    () =>
      buildQuickThreadSearchIndex({
        threads,
        projects,
      }),
    [projects, threads],
  );
  const buildResults = useCallback(
    (query: string) =>
      buildQuickThreadSearchResults({
        index,
        query,
      }),
    [index],
  );

  return (
    <ThreadSearchDialog
      open={open}
      onOpenChange={onOpenChange}
      activeThreadId={activeThreadId}
      focusRequestId={focusRequestId}
      title="Quick Thread Search"
      description={`Search the ${QUICK_THREAD_SEARCH_RECENT_LIMIT} most recent threads using titles and first user messages for a faster jump-to-thread flow.`}
      placeholder="Search recent threads"
      inputTestId="quick-thread-search-input"
      emptyPrompt={`Start typing to search the ${QUICK_THREAD_SEARCH_RECENT_LIMIT} most recent thread titles and opening prompts.`}
      noResultsMessage="No recent threads matched this search."
      buildResults={buildResults}
    />
  );
}
