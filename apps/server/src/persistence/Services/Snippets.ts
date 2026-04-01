import {
  IsoDateTime,
  Snippet,
  SnippetCreateResult,
  SnippetDeleteInput,
  TrimmedNonEmptyString,
  type SnippetLibraryUpdatedPayload,
} from "@t3tools/contracts";
import { Schema, ServiceMap, type Stream } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const UpsertSnippetByExactTextInput = Schema.Struct({
  text: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type UpsertSnippetByExactTextInput = typeof UpsertSnippetByExactTextInput.Type;

export interface SnippetRepositoryShape {
  readonly listAll: () => Effect.Effect<ReadonlyArray<Snippet>, ProjectionRepositoryError>;
  readonly upsertByExactText: (
    input: UpsertSnippetByExactTextInput,
  ) => Effect.Effect<SnippetCreateResult, ProjectionRepositoryError>;
  readonly deleteById: (
    input: SnippetDeleteInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly streamChanges: Stream.Stream<SnippetLibraryUpdatedPayload>;
}

export class SnippetRepository extends ServiceMap.Service<
  SnippetRepository,
  SnippetRepositoryShape
>()("t3/persistence/Services/Snippets/SnippetRepository") {}
