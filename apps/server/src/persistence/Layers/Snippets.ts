import { randomUUID } from "node:crypto";

import {
  SnippetDeleteInput,
  SnippetId,
  type SnippetCreateResult,
  type SnippetLibraryUpdatedPayload,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, Schema, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  SnippetRepository,
  type SnippetRepositoryShape,
  UpsertSnippetByExactTextInput,
} from "../Services/Snippets.ts";

const SnippetDbRow = Schema.Struct({
  id: SnippetId,
  text: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const makeSnippetRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<SnippetLibraryUpdatedPayload>(),
    PubSub.shutdown,
  );

  const listSnippetRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: SnippetDbRow,
    execute: () =>
      sql`
        SELECT
          snippet_id AS "id",
          text,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM snippets
        ORDER BY updated_at DESC, snippet_id DESC
      `,
  });

  const getSnippetRowsByText = SqlSchema.findAll({
    Request: UpsertSnippetByExactTextInput,
    Result: SnippetDbRow,
    execute: ({ text }) =>
      sql`
        SELECT
          snippet_id AS "id",
          text,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM snippets
        WHERE text = ${text}
      `,
  });

  const insertSnippetRow = SqlSchema.void({
    Request: SnippetDbRow,
    execute: (row) =>
      sql`
        INSERT INTO snippets (
          snippet_id,
          text,
          created_at,
          updated_at
        )
        VALUES (
          ${row.id},
          ${row.text},
          ${row.createdAt},
          ${row.updatedAt}
        )
      `,
  });

  const updateSnippetTimestamp = SqlSchema.void({
    Request: SnippetDbRow,
    execute: (row) =>
      sql`
        UPDATE snippets
        SET updated_at = ${row.updatedAt}
        WHERE snippet_id = ${row.id}
      `,
  });

  const deleteSnippetRow = SqlSchema.void({
    Request: SnippetDeleteInput,
    execute: ({ snippetId }) =>
      sql`
        DELETE FROM snippets
        WHERE snippet_id = ${snippetId}
      `,
  });

  const listAll: SnippetRepositoryShape["listAll"] = () =>
    listSnippetRows().pipe(
      Effect.mapError(toPersistenceSqlError("SnippetRepository.listAll:query")),
    );

  const upsertByExactText: SnippetRepositoryShape["upsertByExactText"] = (input) =>
    Effect.gen(function* () {
      const existingRows = yield* getSnippetRowsByText(input).pipe(
        Effect.mapError(toPersistenceSqlError("SnippetRepository.getByText:query")),
      );
      const existing = existingRows[0];
      if (existing) {
        const nextSnippet = {
          ...existing,
          updatedAt: input.updatedAt,
        };
        yield* updateSnippetTimestamp(nextSnippet).pipe(
          Effect.mapError(toPersistenceSqlError("SnippetRepository.updateTimestamp:query")),
        );
        const updatePayload: SnippetLibraryUpdatedPayload = {
          kind: "upsert",
          snippetId: nextSnippet.id,
          updatedAt: nextSnippet.updatedAt,
        };
        yield* PubSub.publish(changesPubSub, updatePayload);
        return {
          snippet: nextSnippet,
          deduped: true,
        } satisfies SnippetCreateResult;
      }

      const snippet = {
        id: SnippetId.makeUnsafe(`snippet-${randomUUID()}`),
        text: input.text,
        createdAt: input.updatedAt,
        updatedAt: input.updatedAt,
      };
      yield* insertSnippetRow(snippet).pipe(
        Effect.mapError(toPersistenceSqlError("SnippetRepository.insert:query")),
      );
      const updatePayload: SnippetLibraryUpdatedPayload = {
        kind: "upsert",
        snippetId: snippet.id,
        updatedAt: snippet.updatedAt,
      };
      yield* PubSub.publish(changesPubSub, updatePayload);
      return {
        snippet,
        deduped: false,
      } satisfies SnippetCreateResult;
    });

  const deleteById: SnippetRepositoryShape["deleteById"] = (input) =>
    deleteSnippetRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("SnippetRepository.deleteById:query")),
      Effect.tap(() => {
        const updatePayload: SnippetLibraryUpdatedPayload = {
          kind: "delete",
          snippetId: input.snippetId,
          updatedAt: new Date().toISOString(),
        };
        return PubSub.publish(changesPubSub, updatePayload);
      }),
    );

  return {
    listAll,
    upsertByExactText,
    deleteById,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies SnippetRepositoryShape;
});

export const SnippetRepositoryLive = Layer.effect(SnippetRepository, makeSnippetRepository);
