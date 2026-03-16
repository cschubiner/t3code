import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  Snippet,
  SnippetCreateInput,
  SnippetCreateResult,
  SnippetDeleteInput,
  SnippetLibraryUpdatedPayload,
  SnippetListResult,
} from "./snippets";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

it.effect("parses snippet records and create results", () =>
  Effect.gen(function* () {
    const snippet = yield* decode(Snippet, {
      id: " snippet-1 ",
      text: "  Re-run the last failing command  ",
      createdAt: "2026-03-16T12:00:00.000Z",
      updatedAt: "2026-03-16T12:05:00.000Z",
    });
    assert.strictEqual(snippet.id, "snippet-1");
    assert.strictEqual(snippet.text, "Re-run the last failing command");

    const result = yield* decode(SnippetCreateResult, {
      snippet,
      deduped: true,
    });
    assert.isTrue(result.deduped);
  }),
);

it.effect("parses snippet list, create input, delete input, and update payload", () =>
  Effect.gen(function* () {
    const createInput = yield* decode(SnippetCreateInput, {
      text: "  Summarize the diff and next steps  ",
    });
    assert.strictEqual(createInput.text, "Summarize the diff and next steps");

    const listResult = yield* decode(SnippetListResult, {
      snippets: [
        {
          id: "snippet-2",
          text: "Summarize the diff and next steps",
          createdAt: "2026-03-16T12:00:00.000Z",
          updatedAt: "2026-03-16T12:10:00.000Z",
        },
      ],
    });
    assert.lengthOf(listResult.snippets, 1);

    const deleteInput = yield* decode(SnippetDeleteInput, {
      snippetId: " snippet-2 ",
    });
    assert.strictEqual(deleteInput.snippetId, "snippet-2");

    const updatePayload = yield* decode(SnippetLibraryUpdatedPayload, {
      kind: "delete",
      snippetId: "snippet-2",
      updatedAt: "2026-03-16T12:11:00.000Z",
    });
    assert.strictEqual(updatePayload.kind, "delete");
  }),
);
