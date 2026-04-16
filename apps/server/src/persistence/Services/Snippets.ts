import {
  IsoDateTime,
  Snippet,
  SnippetCreateResult,
  SnippetDeleteInput,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Context, Schema } from "effect";
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
}

export class SnippetRepository extends Context.Service<SnippetRepository, SnippetRepositoryShape>()(
  "t3/persistence/Services/Snippets/SnippetRepository",
) {}
