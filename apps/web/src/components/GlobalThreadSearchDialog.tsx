import type { ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";

import { buildGlobalThreadSearchResults } from "../lib/globalThreadSearch";
import { useStore } from "../store";
import { ThreadSearchDialog } from "./ThreadSearchDialog";

interface GlobalThreadSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeThreadId: ThreadId | null;
  focusRequestId: number;
}

export function GlobalThreadSearchDialog({
  open,
  onOpenChange,
  activeThreadId,
  focusRequestId,
}: GlobalThreadSearchDialogProps) {
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const buildResults = useCallback(
    (query: string) =>
      buildGlobalThreadSearchResults({
        threads,
        projects,
        query,
      }),
    [projects, threads],
  );

  return (
    <ThreadSearchDialog
      open={open}
      onOpenChange={onOpenChange}
      activeThreadId={activeThreadId}
      focusRequestId={focusRequestId}
      title="Search All Threads"
      description="Search thread titles, user messages, assistant replies, and proposed plans across the current workspace."
      placeholder="Search all threads"
      inputTestId="global-thread-search-input"
      emptyPrompt="Start typing to search across all threads."
      noResultsMessage="No threads matched this search."
      buildResults={buildResults}
    />
  );
}
