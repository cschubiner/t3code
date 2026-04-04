import type { ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { buildHighlightSegments, findTextOccurrences } from "../lib/threadSearch";
import type {
  ThreadSearchDialogResult,
  ThreadSearchDialogResults,
} from "../lib/threadSearchSurface";
import { useThreadSearchNavigationStore } from "../threadSearchNavigationStore";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "~/lib/utils";

interface ThreadSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeThreadId: ThreadId | null;
  focusRequestId: number;
  title: string;
  description: string;
  placeholder: string;
  inputTestId: string;
  emptyPrompt: string;
  noResultsMessage: string;
  buildResults: (query: string) => ThreadSearchDialogResults;
}

function formatResultTimestamp(value: string): string {
  return formatRelativeTimeLabel(value, { style: "long" });
}

function formatExactResultTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function resultKindLabel(kind: ThreadSearchDialogResult["kind"]) {
  switch (kind) {
    case "title":
      return "Title";
    case "message-user":
      return "User";
    case "message-assistant":
      return "Assistant";
    case "proposed-plan":
      return "Plan";
  }
}

export function ThreadSearchDialog({
  open,
  onOpenChange,
  activeThreadId,
  focusRequestId,
  title,
  description,
  placeholder,
  inputTestId,
  emptyPrompt,
  noResultsMessage,
  buildResults,
}: ThreadSearchDialogProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlightedIndex(0);
      return;
    }
    setQuery("");
    setHighlightedIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [focusRequestId, open]);

  const searchResults = useMemo(() => buildResults(deferredQuery), [buildResults, deferredQuery]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setHighlightedIndex(0);
  }, [deferredQuery, open]);

  useEffect(() => {
    if (searchResults.results.length === 0) {
      setHighlightedIndex(0);
      return;
    }
    setHighlightedIndex((current) => Math.min(current, searchResults.results.length - 1));
  }, [searchResults.results.length]);

  const openResult = useCallback(
    async (resultIndex: number) => {
      const result = searchResults.results[resultIndex];
      if (!result) {
        return;
      }

      const request =
        result.kind === "title"
          ? ({
              threadId: result.threadId,
              query: query.trim(),
              kind: "title-match",
            } as const)
          : ({
              threadId: result.threadId,
              query: query.trim(),
              kind: "content-match",
              sourceKind: result.sourceKind === "proposed-plan" ? "proposed-plan" : "message",
              sourceId: result.sourceId,
              occurrenceIndexInSource: result.occurrenceIndexInSource,
            } as const);

      useThreadSearchNavigationStore.getState().setPendingNavigation(request);
      onOpenChange(false);

      if (activeThreadId !== result.threadId) {
        await navigate({
          to: "/$threadId",
          params: {
            threadId: result.threadId,
          },
        });
      }
    },
    [activeThreadId, navigate, onOpenChange, query, searchResults.results],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (searchResults.results.length === 0) return;
      setHighlightedIndex((current) => (current + 1) % searchResults.results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (searchResults.results.length === 0) return;
      setHighlightedIndex(
        (current) => (current - 1 + searchResults.results.length) % searchResults.results.length,
      );
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void openResult(highlightedIndex);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-6xl" bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-2">
            <Input
              ref={inputRef}
              type="search"
              placeholder={placeholder}
              data-testid={inputTestId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
            />
            <div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
              <span>
                {searchResults.totalResults === 0
                  ? "No results"
                  : searchResults.truncated
                    ? `Showing ${searchResults.results.length} of ${searchResults.totalResults} results`
                    : `${searchResults.totalResults} results`}
              </span>
              <span>Enter opens • Up/Down moves • Esc closes</span>
            </div>
          </div>

          <div className="min-h-[28rem] overflow-hidden rounded-xl border">
            <ScrollArea>
              <div className="divide-y">
                {deferredQuery.trim().length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">{emptyPrompt}</div>
                ) : searchResults.results.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">{noResultsMessage}</div>
                ) : (
                  searchResults.results.map((result, index) => {
                    const snippetOccurrences = findTextOccurrences(result.displaySnippet, query);
                    const snippetSegments = buildHighlightSegments(
                      result.displaySnippet,
                      snippetOccurrences,
                    );
                    const titleOccurrences =
                      result.kind === "title" ? findTextOccurrences(result.threadTitle, query) : [];
                    const titleSegments = buildHighlightSegments(
                      result.threadTitle,
                      titleOccurrences,
                    );
                    const isHighlighted = index === highlightedIndex;

                    return (
                      <button
                        key={result.resultId}
                        type="button"
                        data-global-thread-search-result="true"
                        data-highlighted={isHighlighted ? "true" : undefined}
                        className={cn(
                          "flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors",
                          isHighlighted ? "bg-accent/70" : "hover:bg-accent/40",
                        )}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onClick={() => {
                          void openResult(index);
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-sm">
                            {titleSegments.map((segment) =>
                              segment.highlighted ? (
                                <mark
                                  key={`thread-search-title-highlight:${result.resultId}:${segment.key}`}
                                  className="rounded bg-amber-400/35 px-0.5 text-foreground"
                                >
                                  {segment.text}
                                </mark>
                              ) : (
                                <span
                                  key={`thread-search-title-segment:${result.resultId}:${segment.key}`}
                                >
                                  {segment.text}
                                </span>
                              ),
                            )}
                          </span>
                          <Badge variant="outline">{resultKindLabel(result.kind)}</Badge>
                          {result.matchCount > 1 ? (
                            <Badge variant="secondary">{result.matchCount} matches</Badge>
                          ) : null}
                          <span className="text-muted-foreground text-xs">
                            {result.projectName}
                          </span>
                          <span
                            className="ml-auto text-muted-foreground text-[11px]"
                            title={formatExactResultTimestamp(result.sourceCreatedAt)}
                          >
                            {formatResultTimestamp(result.sourceCreatedAt)}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-foreground/80 text-sm">
                          {snippetSegments.map((segment) =>
                            segment.highlighted ? (
                              <mark
                                key={`thread-search-snippet-highlight:${result.resultId}:${segment.key}`}
                                className="rounded bg-amber-400/35 px-0.5 text-foreground"
                              >
                                {segment.text}
                              </mark>
                            ) : (
                              <span
                                key={`thread-search-snippet-segment:${result.resultId}:${segment.key}`}
                              >
                                {segment.text}
                              </span>
                            ),
                          )}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
