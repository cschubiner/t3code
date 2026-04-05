import type {
  ModelSelection,
  NativeApi,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";

import type { Thread } from "./types";
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
