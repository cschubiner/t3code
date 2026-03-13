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
import type { ProviderInteractionMode } from "@t3tools/contracts";
import {
  GripVerticalIcon,
  LoaderCircleIcon,
  PencilIcon,
  SendHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { QueuedComposerTurn } from "../composerDraftStore";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

const QUEUED_TURN_PREVIEW_MAX_CHARS = 72;

function summarizeQueuedTurn(turn: QueuedComposerTurn): string {
  const trimmed = turn.text.trim();
  if (trimmed.length > 0) {
    return trimmed.length > QUEUED_TURN_PREVIEW_MAX_CHARS
      ? `${trimmed.slice(0, QUEUED_TURN_PREVIEW_MAX_CHARS - 1).trimEnd()}...`
      : trimmed;
  }
  const imageCount = turn.images.length;
  if (imageCount > 0) {
    return imageCount === 1 ? "1 image attachment" : `${imageCount} image attachments`;
  }
  return "Queued follow-up";
}

function interactionModeLabel(interactionMode: ProviderInteractionMode): string {
  return interactionMode === "plan" ? "Plan" : "Chat";
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
  queuedTurn: QueuedComposerTurn;
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
  const canSave = draftText.trim().length > 0 || queuedTurn.images.length > 0;
  const preview = summarizeQueuedTurn(queuedTurn);

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "rounded-xl border border-border/70 bg-background/75 px-3 py-3 transition-shadow",
        isDragging && "z-20 opacity-85 shadow-lg",
        isBusy && "ring-1 ring-primary/35",
      )}
      data-testid={`queued-follow-up-row-${queuedTurn.id}`}
    >
      <div className="flex min-w-0 gap-3">
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

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
            {index === 0 ? (
              <Badge variant="secondary" className="rounded-full px-2 text-[11px]">
                Next
              </Badge>
            ) : null}
            <Badge variant="outline" className="rounded-full px-2 text-[11px]">
              {interactionModeLabel(queuedTurn.interactionMode)}
            </Badge>
            {queuedTurn.images.length > 0 ? (
              <Badge variant="outline" className="rounded-full px-2 text-[11px]">
                {queuedTurn.images.length === 1 ? "1 image" : `${queuedTurn.images.length} images`}
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
                data-testid={`queued-follow-up-editor-${queuedTurn.id}`}
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
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{preview}</p>
          )}
        </div>

        {!isEditing ? (
          <div className="flex shrink-0 flex-wrap items-start justify-end gap-1.5 max-sm:w-full max-sm:justify-start">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-full px-2.5 text-xs"
              onClick={onEdit}
              disabled={isInteractionDisabled}
            >
              <PencilIcon className="mr-1 size-3.5" />
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-full px-2.5 text-xs"
              onClick={onSendNow}
              disabled={isInteractionDisabled}
            >
              {isBusy ? (
                <LoaderCircleIcon className="mr-1 size-3.5 animate-spin" />
              ) : (
                <SendHorizontalIcon className="mr-1 size-3.5" />
              )}
              Send now
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-full px-2.5 text-xs text-muted-foreground"
              onClick={onDelete}
              disabled={isInteractionDisabled}
            >
              <Trash2Icon className="mr-1 size-3.5" />
              Delete
            </Button>
          </div>
        ) : (
          <div className="shrink-0 pt-0.5">
            <XIcon className="size-4 text-muted-foreground/70" />
          </div>
        )}
      </div>
    </li>
  );
}

export default function QueuedFollowUpsPanel({
  queuedTurns,
  busyQueuedTurnId,
  isQueueInteractionDisabled,
  onDelete,
  onClearAll,
  onSaveEdit,
  onSendNow,
  onReorder,
}: {
  queuedTurns: QueuedComposerTurn[];
  busyQueuedTurnId: string | null;
  isQueueInteractionDisabled: boolean;
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

  return (
    <div className="border-b border-border/65 bg-muted/15 px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="rounded-full">
          {queuedTurns.length === 1
            ? "1 queued follow-up"
            : `${queuedTurns.length} queued follow-ups`}
        </Badge>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground/80">
          Next: {nextQueuedTurn ? summarizeQueuedTurn(nextQueuedTurn) : "Queued follow-up"}
        </p>
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
          <ol className="mt-2 space-y-2">
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
        </SortableContext>
      </DndContext>
    </div>
  );
}
