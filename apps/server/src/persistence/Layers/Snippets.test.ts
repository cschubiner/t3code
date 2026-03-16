import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { SnippetRepositoryLive } from "./Snippets.ts";
import { SnippetRepository } from "../Services/Snippets.ts";

const snippetRepositoryLayer = it.layer(
  SnippetRepositoryLive.pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

snippetRepositoryLayer("SnippetRepository", (it) => {
  it.effect("creates snippets, dedupes exact trimmed text, and bumps recency on re-save", () =>
    Effect.gen(function* () {
      const repository = yield* SnippetRepository;

      const first = yield* repository.upsertByExactText({
        text: "Re-run the last failing command",
        updatedAt: "2026-03-16T12:00:00.000Z",
      });
      assert.isFalse(first.deduped);

      const second = yield* repository.upsertByExactText({
        text: "Summarize the diff and next steps",
        updatedAt: "2026-03-16T12:05:00.000Z",
      });
      assert.isFalse(second.deduped);

      const deduped = yield* repository.upsertByExactText({
        text: "Re-run the last failing command",
        updatedAt: "2026-03-16T12:10:00.000Z",
      });
      assert.isTrue(deduped.deduped);
      assert.strictEqual(deduped.snippet.id, first.snippet.id);
      assert.strictEqual(deduped.snippet.updatedAt, "2026-03-16T12:10:00.000Z");

      const snippets = yield* repository.listAll();
      assert.deepEqual(
        snippets.map((snippet) => ({
          id: snippet.id,
          text: snippet.text,
          updatedAt: snippet.updatedAt,
        })),
        [
          {
            id: first.snippet.id,
            text: "Re-run the last failing command",
            updatedAt: "2026-03-16T12:10:00.000Z",
          },
          {
            id: second.snippet.id,
            text: "Summarize the diff and next steps",
            updatedAt: "2026-03-16T12:05:00.000Z",
          },
        ],
      );
    }),
  );

  it.effect("deletes snippets by id", () =>
    Effect.gen(function* () {
      const repository = yield* SnippetRepository;

      const created = yield* repository.upsertByExactText({
        text: "Keep this handy",
        updatedAt: "2026-03-16T13:00:00.000Z",
      });

      yield* repository.deleteById({ snippetId: created.snippet.id });
      const snippets = yield* repository.listAll();
      assert.ok(!snippets.some((s) => s.id === created.snippet.id));
    }),
  );
});
