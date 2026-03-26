import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type ColumnRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const queuedTurnColumns = yield* sql<ColumnRow>`
    SELECT name
    FROM pragma_table_info('projection_thread_queued_turns')
  `;

  if (!queuedTurnColumns.some((column) => column.name === "sort_order")) {
    yield* sql`
      ALTER TABLE projection_thread_queued_turns
      ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0
    `;
  }

  yield* sql`
    WITH ordered AS (
      SELECT
        message_id,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id
          ORDER BY queued_at ASC, message_id ASC
        ) - 1 AS next_sort_order
      FROM projection_thread_queued_turns
    )
    UPDATE projection_thread_queued_turns
    SET sort_order = (
      SELECT ordered.next_sort_order
      FROM ordered
      WHERE ordered.message_id = projection_thread_queued_turns.message_id
    )
    WHERE message_id IN (SELECT message_id FROM ordered)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_queued_turns_thread_sort_order
    ON projection_thread_queued_turns(thread_id, sort_order, queued_at)
  `;
});
