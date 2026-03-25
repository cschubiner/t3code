import type { Snippet, SnippetId } from "@t3tools/contracts";
import { Trash2Icon } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
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

interface SnippetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snippets: readonly Snippet[];
  focusRequestId: number;
  deletingSnippetId?: SnippetId | null;
  onSelectSnippet: (snippet: Snippet) => void;
  onDeleteSnippet: (snippet: Snippet) => void;
}

function formatSnippetTimestamp(value: string): string {
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

function summarizeSnippet(text: string): string {
  const trimmed = text.trim();
  const normalized = trimmed.replace(/\s+/g, " ");
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117).trimEnd()}...`;
}

export function SnippetPickerDialog({
  open,
  onOpenChange,
  snippets,
  focusRequestId,
  deletingSnippetId = null,
  onSelectSnippet,
  onDeleteSnippet,
}: SnippetPickerDialogProps) {
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

  const filteredSnippets = useMemo(() => {
    const sortedSnippets = snippets.toSorted((left, right) => {
      const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
      if (updatedAtComparison !== 0) {
        return updatedAtComparison;
      }
      return String(right.id).localeCompare(String(left.id));
    });
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return sortedSnippets;
    }
    return sortedSnippets.filter((snippet) => snippet.text.toLowerCase().includes(normalizedQuery));
  }, [deferredQuery, snippets]);

  useEffect(() => {
    if (filteredSnippets.length === 0) {
      setHighlightedIndex(0);
      return;
    }
    setHighlightedIndex((current) => Math.min(current, filteredSnippets.length - 1));
  }, [filteredSnippets.length]);

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredSnippets.length === 0) return;
      setHighlightedIndex((current) => (current + 1) % filteredSnippets.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredSnippets.length === 0) return;
      setHighlightedIndex(
        (current) => (current - 1 + filteredSnippets.length) % filteredSnippets.length,
      );
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const snippet = filteredSnippets[highlightedIndex];
    if (!snippet) return;
    onSelectSnippet(snippet);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl" bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>Snippets</DialogTitle>
          <DialogDescription>
            Search saved snippets and press Enter to insert one into the composer.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-2">
            <Input
              ref={inputRef}
              type="search"
              placeholder="Search snippets"
              data-testid="snippet-picker-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
            />
            <div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
              <span>
                {snippets.length === 0
                  ? "No saved snippets yet. Heart a queued follow-up to save one."
                  : filteredSnippets.length === 0
                    ? "No snippets matched this search."
                    : `${filteredSnippets.length} snippet${filteredSnippets.length === 1 ? "" : "s"}`}
              </span>
              <span>Enter inserts • Up/Down moves • Esc closes</span>
            </div>
          </div>

          <div className="min-h-[24rem] overflow-hidden rounded-xl border">
            <ScrollArea>
              <div className="divide-y">
                {snippets.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">
                    No saved snippets yet. Heart a queued follow-up to save one.
                  </div>
                ) : filteredSnippets.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">
                    No snippets matched this search.
                  </div>
                ) : (
                  filteredSnippets.map((snippet, index) => {
                    const isHighlighted = index === highlightedIndex;
                    const isDeleting = deletingSnippetId === snippet.id;

                    return (
                      <div
                        key={snippet.id}
                        data-snippet-picker-result="true"
                        data-highlighted={isHighlighted ? "true" : undefined}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3 transition-colors",
                          isHighlighted ? "bg-accent/70" : "hover:bg-accent/40",
                        )}
                        onMouseEnter={() => setHighlightedIndex(index)}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 space-y-2 text-left"
                          onClick={() => {
                            onSelectSnippet(snippet);
                          }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">Snippet</Badge>
                            <span className="text-muted-foreground text-[11px]">
                              {formatSnippetTimestamp(snippet.updatedAt)}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                            {summarizeSnippet(snippet.text)}
                          </p>
                        </button>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          className="mt-0.5 shrink-0"
                          aria-label="Delete snippet"
                          data-testid={`snippet-picker-delete-${snippet.id}`}
                          disabled={isDeleting}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onDeleteSnippet(snippet);
                          }}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </div>
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
