import { Effect, Layer, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { ChatAttachment, ProviderModelOptions, ProviderStartOptions } from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadQueuedTurnInput,
  DeleteProjectionThreadQueuedTurnsByThreadInput,
  ListProjectionThreadQueuedTurnsInput,
  ProjectionThreadQueuedTurn,
  ProjectionThreadQueuedTurnRepository,
  type ProjectionThreadQueuedTurnRepositoryShape,
} from "../Services/ProjectionThreadQueuedTurns.ts";

const ProjectionThreadQueuedTurnDbRowSchema = ProjectionThreadQueuedTurn.mapFields(
  Struct.assign({
    attachments: Schema.fromJsonString(Schema.Array(ChatAttachment)),
    modelOptions: Schema.NullOr(Schema.fromJsonString(ProviderModelOptions)),
    providerOptions: Schema.NullOr(Schema.fromJsonString(ProviderStartOptions)),
  }),
);

const makeProjectionThreadQueuedTurnRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadQueuedTurnRow = SqlSchema.void({
    Request: ProjectionThreadQueuedTurn,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_queued_turns (
          message_id,
          thread_id,
          text,
          attachments_json,
          provider,
          model,
          service_tier,
          model_options_json,
          provider_options_json,
          assistant_delivery_mode,
          runtime_mode,
          interaction_mode,
          queued_at
        )
        VALUES (
          ${row.messageId},
          ${row.threadId},
          ${row.text},
          ${JSON.stringify(row.attachments)},
          ${row.provider},
          ${row.model},
          ${row.serviceTier},
          ${row.modelOptions === null ? null : JSON.stringify(row.modelOptions)},
          ${row.providerOptions === null ? null : JSON.stringify(row.providerOptions)},
          ${row.assistantDeliveryMode},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.queuedAt}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          text = excluded.text,
          attachments_json = excluded.attachments_json,
          provider = excluded.provider,
          model = excluded.model,
          service_tier = excluded.service_tier,
          model_options_json = excluded.model_options_json,
          provider_options_json = excluded.provider_options_json,
          assistant_delivery_mode = excluded.assistant_delivery_mode,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          queued_at = excluded.queued_at
      `,
  });

  const listProjectionThreadQueuedTurnRows = SqlSchema.findAll({
    Request: ListProjectionThreadQueuedTurnsInput,
    Result: ProjectionThreadQueuedTurnDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          text,
          attachments_json AS "attachments",
          provider,
          model,
          service_tier AS "serviceTier",
          model_options_json AS "modelOptions",
          provider_options_json AS "providerOptions",
          assistant_delivery_mode AS "assistantDeliveryMode",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          queued_at AS "queuedAt"
        FROM projection_thread_queued_turns
        WHERE thread_id = ${threadId}
        ORDER BY queued_at ASC, message_id ASC
      `,
  });

  const deleteProjectionThreadQueuedTurnRow = SqlSchema.void({
    Request: DeleteProjectionThreadQueuedTurnInput,
    execute: ({ messageId }) =>
      sql`
        DELETE FROM projection_thread_queued_turns
        WHERE message_id = ${messageId}
      `,
  });

  const deleteProjectionThreadQueuedTurnRowsByThread = SqlSchema.void({
    Request: DeleteProjectionThreadQueuedTurnsByThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_queued_turns
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadQueuedTurnRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadQueuedTurnRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadQueuedTurnRepository.upsert:query")),
    );

  const listByThreadId: ProjectionThreadQueuedTurnRepositoryShape["listByThreadId"] = (input) =>
    listProjectionThreadQueuedTurnRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadQueuedTurnRepository.listByThreadId:query"),
      ),
    );

  const deleteByMessageId: ProjectionThreadQueuedTurnRepositoryShape["deleteByMessageId"] = (
    input,
  ) =>
    deleteProjectionThreadQueuedTurnRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadQueuedTurnRepository.deleteByMessageId:query"),
      ),
    );

  const deleteByThreadId: ProjectionThreadQueuedTurnRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadQueuedTurnRowsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadQueuedTurnRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    listByThreadId,
    deleteByMessageId,
    deleteByThreadId,
  } satisfies ProjectionThreadQueuedTurnRepositoryShape;
});

export const ProjectionThreadQueuedTurnRepositoryLive = Layer.effect(
  ProjectionThreadQueuedTurnRepository,
  makeProjectionThreadQueuedTurnRepository,
);
