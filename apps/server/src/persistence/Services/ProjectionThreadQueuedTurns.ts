import {
  AssistantDeliveryMode,
  ChatAttachment,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProviderInteractionMode,
  ProviderKind,
  ProviderModelOptions,
  ProviderServiceTier,
  ProviderStartOptions,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadQueuedTurn = Schema.Struct({
  messageId: MessageId,
  threadId: ThreadId,
  sortOrder: NonNegativeInt,
  text: Schema.String,
  attachments: Schema.Array(ChatAttachment),
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(Schema.String),
  serviceTier: Schema.NullOr(ProviderServiceTier),
  modelOptions: Schema.NullOr(ProviderModelOptions),
  providerOptions: Schema.NullOr(ProviderStartOptions),
  assistantDeliveryMode: AssistantDeliveryMode,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  queuedAt: IsoDateTime,
});
export type ProjectionThreadQueuedTurn = typeof ProjectionThreadQueuedTurn.Type;

export const ListProjectionThreadQueuedTurnsInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionThreadQueuedTurnsInput = typeof ListProjectionThreadQueuedTurnsInput.Type;

export const DeleteProjectionThreadQueuedTurnInput = Schema.Struct({
  messageId: MessageId,
});
export type DeleteProjectionThreadQueuedTurnInput =
  typeof DeleteProjectionThreadQueuedTurnInput.Type;

export const GetProjectionThreadQueuedTurnInput = Schema.Struct({
  messageId: MessageId,
});
export type GetProjectionThreadQueuedTurnInput = typeof GetProjectionThreadQueuedTurnInput.Type;

export const DeleteProjectionThreadQueuedTurnsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadQueuedTurnsByThreadInput =
  typeof DeleteProjectionThreadQueuedTurnsByThreadInput.Type;

export interface ProjectionThreadQueuedTurnRepositoryShape {
  readonly upsert: (
    row: ProjectionThreadQueuedTurn,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: ListProjectionThreadQueuedTurnsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadQueuedTurn>, ProjectionRepositoryError>;
  readonly getByMessageId: (
    input: GetProjectionThreadQueuedTurnInput,
  ) => Effect.Effect<ProjectionThreadQueuedTurn | null, ProjectionRepositoryError>;
  readonly deleteByMessageId: (
    input: DeleteProjectionThreadQueuedTurnInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadQueuedTurnsByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadQueuedTurnRepository extends ServiceMap.Service<
  ProjectionThreadQueuedTurnRepository,
  ProjectionThreadQueuedTurnRepositoryShape
>()("t3/persistence/Services/ProjectionThreadQueuedTurns/ProjectionThreadQueuedTurnRepository") {}
