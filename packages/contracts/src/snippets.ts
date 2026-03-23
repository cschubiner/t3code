import { Schema } from "effect";
import { IsoDateTime, SnippetId, TrimmedNonEmptyString } from "./baseSchemas";

export const Snippet = Schema.Struct({
  id: SnippetId,
  text: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Snippet = typeof Snippet.Type;

export const SnippetListResult = Schema.Struct({
  snippets: Schema.Array(Snippet),
});
export type SnippetListResult = typeof SnippetListResult.Type;

export const SnippetCreateInput = Schema.Struct({
  text: TrimmedNonEmptyString,
});
export type SnippetCreateInput = typeof SnippetCreateInput.Type;

export const SnippetCreateResult = Schema.Struct({
  snippet: Snippet,
  deduped: Schema.Boolean,
});
export type SnippetCreateResult = typeof SnippetCreateResult.Type;

export const SnippetDeleteInput = Schema.Struct({
  snippetId: SnippetId,
});
export type SnippetDeleteInput = typeof SnippetDeleteInput.Type;

export const SnippetLibraryUpdatedPayload = Schema.Struct({
  kind: Schema.Literals(["upsert", "delete"]),
  snippetId: SnippetId,
  updatedAt: IsoDateTime,
});
export type SnippetLibraryUpdatedPayload = typeof SnippetLibraryUpdatedPayload.Type;
