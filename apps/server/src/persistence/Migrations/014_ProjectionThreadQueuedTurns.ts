import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_queued_turns (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      attachments_json TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      service_tier TEXT,
      model_options_json TEXT,
      provider_options_json TEXT,
      assistant_delivery_mode TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      queued_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_queued_turns_thread_queued
    ON projection_thread_queued_turns(thread_id, sort_order, queued_at)
  `;
});
