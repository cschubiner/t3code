import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type ColumnRow = {
  readonly name: string;
};

function hasColumn(rows: ReadonlyArray<ColumnRow>, columnName: string): boolean {
  return rows.some((row) => row.name === columnName);
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const proposedPlanColumns = yield* sql<ColumnRow>`
    SELECT name
    FROM pragma_table_info('projection_thread_proposed_plans')
  `;

  if (!hasColumn(proposedPlanColumns, "implemented_at")) {
    yield* sql`
      ALTER TABLE projection_thread_proposed_plans
      ADD COLUMN implemented_at TEXT
    `;
  }

  if (!hasColumn(proposedPlanColumns, "implementation_thread_id")) {
    yield* sql`
      ALTER TABLE projection_thread_proposed_plans
      ADD COLUMN implementation_thread_id TEXT
    `;
  }

  const projectionTurnColumns = yield* sql<ColumnRow>`
    SELECT name
    FROM pragma_table_info('projection_turns')
  `;

  if (!hasColumn(projectionTurnColumns, "source_proposed_plan_thread_id")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN source_proposed_plan_thread_id TEXT
    `;
  }

  if (!hasColumn(projectionTurnColumns, "source_proposed_plan_id")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN source_proposed_plan_id TEXT
    `;
  }
});
