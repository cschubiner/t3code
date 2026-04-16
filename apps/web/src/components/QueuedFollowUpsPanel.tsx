/**
 * QueuedFollowUpsPanel
 *
 * Renders above the composer. Shows any messages the user queued while
 * a turn was in-flight, in FIFO order. Each row can be sent-now, edited
 * inline, or deleted. "Clear all" wipes the thread's queue.
 *
 * Owned state lives in `queuedTurnStore` (per-thread, keyed by
 * scopedThreadKey). The composer hosts read + delete + edit + sendNow
 * actions and passes them in as callbacks.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  BookmarkPlusIcon,
  CheckIcon,
  PencilIcon,
  SendHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";

import type { QueuedTurnDraft } from "../queuedTurnStore";

export interface QueuedFollowUpsPanelProps {
  threadRef: ScopedThreadRef;
  queuedItems: readonly QueuedTurnDraft[];
  canSendNow: boolean;
  onSendNow: (draft: QueuedTurnDraft) => void;
  onDelete: (draft: QueuedTurnDraft) => void;
  onClearAll: () => void;
  onReplaceText: (draft: QueuedTurnDraft, nextText: string) => void;
  /** If provided, shows a bookmark button that saves this row as a snippet. */
  onSaveAsSnippet?: (draft: QueuedTurnDraft) => void;
}

const PREVIEW_MAX_CHARS = 120;

function summarize(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= PREVIEW_MAX_CHARS) return normalized;
  return `${normalized.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}

export function QueuedFollowUpsPanel({
  queuedItems,
  canSendNow,
  onSendNow,
  onDelete,
  onClearAll,
  onReplaceText,
  onSaveAsSnippet,
}: QueuedFollowUpsPanelProps) {
  if (queuedItems.length === 0) return null;

  return (
    <div
      className="mb-2 rounded-lg border border-border bg-muted/30 p-2 text-xs"
      data-testid="queued-follow-ups-panel"
      aria-label="Queued follow-up messages"
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="font-medium text-muted-foreground">
          Queued follow-ups ({queuedItems.length})
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={onClearAll}
          aria-label="Clear all queued follow-ups"
        >
          Clear all
        </Button>
      </div>
      <ul className="flex flex-col gap-1">
        {queuedItems.map((item, index) => (
          <QueuedFollowUpRow
            key={item.id}
            item={item}
            isNext={index === 0}
            canSendNow={canSendNow}
            onSendNow={() => onSendNow(item)}
            onDelete={() => onDelete(item)}
            onReplaceText={(text) => onReplaceText(item, text)}
            {...(onSaveAsSnippet ? { onSaveAsSnippet: () => onSaveAsSnippet(item) } : {})}
          />
        ))}
      </ul>
    </div>
  );
}

function QueuedFollowUpRow({
  item,
  isNext,
  canSendNow,
  onSendNow,
  onDelete,
  onReplaceText,
  onSaveAsSnippet,
}: {
  item: QueuedTurnDraft;
  isNext: boolean;
  canSendNow: boolean;
  onSendNow: () => void;
  onDelete: () => void;
  onReplaceText: (text: string) => void;
  onSaveAsSnippet?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(item.text);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraftText(item.text);
  }, [editing, item.text]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      );
    }
  }, [editing]);

  const handleSave = useCallback(() => {
    onReplaceText(draftText);
    setEditing(false);
  }, [draftText, onReplaceText]);

  const handleCancel = useCallback(() => {
    setDraftText(item.text);
    setEditing(false);
  }, [item.text]);

  return (
    <li
      className={cn(
        "group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors",
        "hover:bg-muted/50",
        isNext && "bg-muted/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-px text-[10px] font-medium",
          isNext ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}
        aria-label={isNext ? "Next to dispatch" : `Position ${item ? 0 : 0}`}
      >
        {isNext ? "Next" : "·"}
      </span>
      {editing ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <textarea
            ref={textareaRef}
            className="min-h-[3rem] w-full resize-y rounded border border-border bg-background p-1.5 text-xs text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                handleSave();
              } else if (event.key === "Escape") {
                event.preventDefault();
                handleCancel();
              }
            }}
          />
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={handleSave}
              aria-label="Save queued follow-up"
            >
              <CheckIcon className="size-3" />
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-muted-foreground"
              onClick={handleCancel}
              aria-label="Cancel edit"
            >
              <XIcon className="size-3" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <span className="min-w-0 flex-1 truncate text-foreground" title={item.text}>
          {summarize(item.text)}
        </span>
      )}
      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(true)}
            aria-label="Edit queued follow-up"
          >
            <PencilIcon className="size-3" />
          </Button>
          {onSaveAsSnippet ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={onSaveAsSnippet}
              aria-label="Save as snippet"
              title="Save as snippet"
            >
              <BookmarkPlusIcon className="size-3" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={onSendNow}
            disabled={!canSendNow}
            aria-label="Send this queued follow-up now"
            title={canSendNow ? "Send now" : "Wait for the current turn to settle"}
          >
            <SendHorizontalIcon className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Remove queued follow-up"
          >
            <Trash2Icon className="size-3" />
          </Button>
        </div>
      )}
    </li>
  );
}
