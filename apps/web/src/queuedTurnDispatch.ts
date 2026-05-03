import type {
  MessageId,
  ModelSelection,
  NativeApi,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";

import type { Thread } from "./types";
import type { QueuedTurnDraft } from "./queuedTurnStore";
import { newCommandId } from "~/lib/utils";

interface PersistThreadSettingsForNextTurnInput {
  thread: Pick<Thread, "id" | "modelSelection" | "runtimeMode" | "interactionMode">;
  createdAt: string;
  modelSelection?: ModelSelection | undefined;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
}

export function modelSelectionsEqual(
  left: ModelSelection | null | undefined,
  right: ModelSelection | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    JSON.stringify(left.options ?? null) === JSON.stringify(right.options ?? null)
  );
}

export async function persistThreadSettingsForNextTurn(
  api: NativeApi,
  input: PersistThreadSettingsForNextTurnInput,
): Promise<void> {
  if (
    input.modelSelection !== undefined &&
    !modelSelectionsEqual(input.modelSelection, input.thread.modelSelection)
  ) {
    await api.orchestration.dispatchCommand({
      type: "thread.meta.update",
      commandId: newCommandId(),
      threadId: input.thread.id as ThreadId,
      modelSelection: input.modelSelection,
    });
  }

  if (input.runtimeMode !== input.thread.runtimeMode) {
    await api.orchestration.dispatchCommand({
      type: "thread.runtime-mode.set",
      commandId: newCommandId(),
      threadId: input.thread.id as ThreadId,
      runtimeMode: input.runtimeMode,
      createdAt: input.createdAt,
    });
  }

  if (input.interactionMode !== input.thread.interactionMode) {
    await api.orchestration.dispatchCommand({
      type: "thread.interaction-mode.set",
      commandId: newCommandId(),
      threadId: input.thread.id as ThreadId,
      interactionMode: input.interactionMode,
      createdAt: input.createdAt,
    });
  }
}

export async function dispatchQueuedTurnCommand(
  api: NativeApi,
  input: {
    thread: Pick<Thread, "id" | "title" | "modelSelection" | "runtimeMode" | "interactionMode">;
    queuedTurn: QueuedTurnDraft;
    createdAt: string;
    fallbackModelSelection?: ModelSelection | null | undefined;
  },
): Promise<void> {
  const modelSelectionForSend =
    input.queuedTurn.modelSelection ?? input.thread.modelSelection ?? input.fallbackModelSelection;

  await persistThreadSettingsForNextTurn(api, {
    thread: input.thread,
    createdAt: input.createdAt,
    modelSelection: modelSelectionForSend ?? undefined,
    runtimeMode: input.queuedTurn.runtimeMode,
    interactionMode: input.queuedTurn.interactionMode,
  });

  await api.orchestration.dispatchCommand({
    type: "thread.turn.start",
    commandId: newCommandId(),
    threadId: input.thread.id as ThreadId,
    message: {
      messageId: input.queuedTurn.id as MessageId,
      role: "user",
      text: input.queuedTurn.text,
      attachments: input.queuedTurn.attachments.map((attachment) => ({
        type: "image" as const,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        dataUrl: attachment.dataUrl,
      })),
    },
    modelSelection: modelSelectionForSend ?? undefined,
    titleSeed: input.thread.title,
    runtimeMode: input.queuedTurn.runtimeMode,
    interactionMode: input.queuedTurn.interactionMode,
    createdAt: input.createdAt,
  });
}
