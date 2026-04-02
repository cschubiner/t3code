import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, LoaderCircleIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  type QueuedTurnDraft,
  type QueuedTurnPauseReason,
  type QueuedTurnDispatchBlockReason,
} from "../queuedTurnStore";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

const QUEUED_TURN_PREVIEW_MAX_CHARS = 72;
const QUEUED_FOLLOW_UP_VISIBLE_ROWS = 2.75;
const QUEUED_FOLLOW_UP_ROW_MIN_HEIGHT_REM = 4.25;
const QUEUED_FOLLOW_UP_ROW_GAP_REM = 0.5;
const QUEUED_FOLLOW_UP_SCROLL_MAX_HEIGHT_REM =
  QUEUED_FOLLOW_UP_VISIBLE_ROWS * QUEUED_FOLLOW_UP_ROW_MIN_HEIGHT_REM +
  (QUEUED_FOLLOW_UP_VISIBLE_ROWS - 1) * QUEUED_FOLLOW_UP_ROW_GAP_REM;

function summarizeQueuedTurn(turn: QueuedTurnDraft): string {
  const trimmed = turn.text.trim();
  if (trimmed.length > 0) {
    return trimmed.length > QUEUED_TURN_PREVIEW_MAX_CHARS
      ? `${trimmed.slice(0, QUEUED_TURN_PREVIEW_MAX_CHARS - 1).trimEnd()}...`
      : trimmed;
  }
  const attachmentCount = turn.attachments.length;
  if (attachmentCount > 0) {
    return attachmentCount === 1 ? "1 image attachment" : `${attachmentCount} image attachments`;
  }
  return "Queued follow-up";
}

function interactionModeLabel(interactionMode: QueuedTurnDraft["interactionMode"]): string {
  return interactionMode === "plan" ? "Plan" : "Chat";
}

function formatPauseReason(reason: QueuedTurnPauseReason): string {
  switch (reason) {
    case "thread-error":
      return "Paused after a thread error";
    case "session-error":
      return "Paused after a session error";
    case "session-interrupted":
      return "Paused after the session was interrupted";
    case "pending-approval":
      return "Paused until the current approval is resolved";
    case "pending-user-input":
      return "Paused until the current questions are answered";
  }
}

function formatBlockReason(reason: QueuedTurnDispatchBlockReason | null): string | null {
  switch (reason) {
    case "disconnected":
      return "Waiting for the thread to reconnect";
    case "connecting":
      return "Waiting for the session to finish connecting";
    case "running":
      return "Waiting for the current turn to finish";
    case "local-dispatch":
      return "Waiting for the current send to be acknowledged";
    default:
      return null;
  }
}

function SortableQueuedFollowUpRow({
  queuedTurn,
  index,
  isEditing,
  isBusy,
  isInteractionDisabled,
  draftText,
  onDraftTextChange,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onSendNow,
}: {
  queuedTurn: QueuedTurnDraft;
  index: number;
  isEditing: boolean;
  isBusy: boolean;
  isInteractionDisabled: boolean;
  draftText: string;
  onDraftTextChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onSendNow: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: queuedTurn.id,
    disabled: isInteractionDisabled || isEditing,
  });
  const canSave = draftText.trim().length > 0 || queuedTurn.attachments.length > 0;
  const preview = summarizeQueuedTurn(queuedTurn);

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "rounded-lg border border-border/60 bg-background/70 px-2.5 py-2 transition-shadow",
        isDragging && "z-20 opacity-85 shadow-lg",
        isBusy && "ring-1 ring-primary/35",
      )}
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
        <button
          type="button"
          className={cn(
            "mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors",
            isInteractionDisabled || isEditing
              ? "cursor-not-allowed opacity-40"
              : "hover:bg-accent hover:text-foreground",
          )}
          aria-label={`Reorder queued follow-up ${index + 1}`}
          disabled={isInteractionDisabled || isEditing}
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-4" />
        </button>

        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">#{index + 1}</span>
            {index === 0 ? (
              <Badge variant="secondary" size="sm" className="rounded-full px-1.5 text-[10px]">
                Next
              </Badge>
            ) : null}
            <Badge variant="outline" size="sm" className="rounded-full px-1.5 text-[10px]">
              {interactionModeLabel(queuedTurn.interactionMode)}
            </Badge>
            {queuedTurn.attachments.length > 0 ? (
              <Badge variant="outline" size="sm" className="rounded-full px-1.5 text-[10px]">
                {queuedTurn.attachments.length === 1
                  ? "1 image"
                  : `${queuedTurn.attachments.length} images`}
              </Badge>
            ) : null}
          </div>

          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={draftText}
                onChange={(event) => onDraftTextChange(event.target.value)}
                rows={3}
                autoFocus
                className="w-full"
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={onSave} disabled={!canSave}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <p className="line-clamp-2 text-[13px] leading-5 break-words text-foreground">
              {preview}
            </p>
          )}
        </div>

        {!isEditing ? (
          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border/60 bg-muted/30 p-0.5">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="rounded-full text-muted-foreground hover:bg-background/80 hover:text-foreground"
              onClick={onEdit}
              disabled={isInteractionDisabled}
              aria-label="Edit"
              title="Edit"
            >
              <PencilIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="secondary"
              className="rounded-full border-primary/10 bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
              onClick={onSendNow}
              disabled={isInteractionDisabled}
              aria-label="Send now"
              title="Send now"
            >
              {isBusy ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <PlayIcon className="size-3.5" />
              )}
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="rounded-full text-muted-foreground hover:bg-background/80 hover:text-destructive"
              onClick={onDelete}
              disabled={isInteractionDisabled}
              aria-label="Delete"
              title="Delete"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function QueuedFollowUpsPanel({
  queuedTurns,
  pauseReason,
  blockReason,
  busyQueuedTurnId,
  isQueueInteractionDisabled,
  canResume,
  onResume,
  onDelete,
  onClearAll,
  onSaveEdit,
  onSendNow,
  onReorder,
}: {
  queuedTurns: ReadonlyArray<QueuedTurnDraft>;
  pauseReason: QueuedTurnPauseReason | null;
  blockReason: QueuedTurnDispatchBlockReason | null;
  busyQueuedTurnId: string | null;
  isQueueInteractionDisabled: boolean;
  canResume: boolean;
  onResume: () => void;
  onDelete: (queuedTurnId: string) => void;
  onClearAll: () => void;
  onSaveEdit: (queuedTurnId: string, text: string) => void;
  onSendNow: (queuedTurnId: string) => void;
  onReorder: (activeQueuedTurnId: string, targetQueuedTurnId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const [editingQueuedTurnId, setEditingQueuedTurnId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const queuedTurnById = useMemo(
    () => new Map(queuedTurns.map((queuedTurn) => [queuedTurn.id, queuedTurn] as const)),
    [queuedTurns],
  );

  useEffect(() => {
    if (!editingQueuedTurnId) {
      return;
    }
    const queuedTurn = queuedTurnById.get(editingQueuedTurnId);
    if (!queuedTurn) {
      setEditingQueuedTurnId(null);
      setDraftText("");
    }
  }, [editingQueuedTurnId, queuedTurnById]);

  if (queuedTurns.length === 0) {
    return null;
  }

  const nextQueuedTurn = queuedTurns[0];
  const interactionDisabled = isQueueInteractionDisabled || busyQueuedTurnId !== null;
  const queueStatusCopy =
    pauseReason !== null ? formatPauseReason(pauseReason) : formatBlockReason(blockReason);

  return (
    <div className="border-b border-border/65 bg-muted/15 px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="rounded-full">
          {queuedTurns.length === 1
            ? "1 queued follow-up"
            : `${queuedTurns.length} queued follow-ups`}
        </Badge>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground/80">
          {queueStatusCopy ? `${queueStatusCopy}. ` : ""}
          Next: {nextQueuedTurn ? summarizeQueuedTurn(nextQueuedTurn) : "Queued follow-up"}
        </p>
        {pauseReason !== null ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-full px-3 text-xs"
            onClick={onResume}
            disabled={!canResume || interactionDisabled}
          >
            Resume
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 rounded-full px-3 text-xs"
          onClick={onClearAll}
          disabled={interactionDisabled || editingQueuedTurnId !== null}
        >
          Clear all
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={(event: DragEndEvent) => {
          const { active, over } = event;
          if (!over || active.id === over.id) {
            return;
          }
          onReorder(String(active.id), String(over.id));
        }}
      >
        <SortableContext
          items={queuedTurns.map((queuedTurn) => queuedTurn.id)}
          strategy={verticalListSortingStrategy}
        >
          <div
            className="mt-2 overflow-y-auto pr-1"
            style={{ maxHeight: `${QUEUED_FOLLOW_UP_SCROLL_MAX_HEIGHT_REM}rem` }}
          >
            <ol className="space-y-2">
              {queuedTurns.map((queuedTurn, index) => (
                <SortableQueuedFollowUpRow
                  key={queuedTurn.id}
                  queuedTurn={queuedTurn}
                  index={index}
                  isEditing={editingQueuedTurnId === queuedTurn.id}
                  isBusy={busyQueuedTurnId === queuedTurn.id}
                  isInteractionDisabled={interactionDisabled}
                  draftText={editingQueuedTurnId === queuedTurn.id ? draftText : queuedTurn.text}
                  onDraftTextChange={setDraftText}
                  onEdit={() => {
                    setEditingQueuedTurnId(queuedTurn.id);
                    setDraftText(queuedTurn.text);
                  }}
                  onSave={() => {
                    onSaveEdit(queuedTurn.id, draftText);
                    setEditingQueuedTurnId(null);
                    setDraftText("");
                  }}
                  onCancel={() => {
                    setEditingQueuedTurnId(null);
                    setDraftText("");
                  }}
                  onDelete={() => {
                    onDelete(queuedTurn.id);
                    if (editingQueuedTurnId === queuedTurn.id) {
                      setEditingQueuedTurnId(null);
                      setDraftText("");
                    }
                  }}
                  onSendNow={() => onSendNow(queuedTurn.id)}
                />
              ))}
            </ol>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
