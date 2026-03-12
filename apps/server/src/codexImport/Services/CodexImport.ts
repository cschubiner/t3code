import type {
  CodexImportImportSessionsInput,
  CodexImportImportSessionsResult,
  CodexImportListSessionsInput,
  CodexImportPeekSessionInput,
  CodexImportPeekSessionResult,
  CodexImportSessionSummary,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class CodexImportError extends Schema.TaggedErrorClass<CodexImportError>()(
  "CodexImportError",
  {
    message: Schema.String,
  },
) {}

export interface CodexImportShape {
  readonly listSessions: (
    input: CodexImportListSessionsInput,
  ) => Effect.Effect<ReadonlyArray<CodexImportSessionSummary>, CodexImportError>;
  readonly peekSession: (
    input: CodexImportPeekSessionInput,
  ) => Effect.Effect<CodexImportPeekSessionResult, CodexImportError>;
  readonly importSessions: (
    input: CodexImportImportSessionsInput,
  ) => Effect.Effect<CodexImportImportSessionsResult, CodexImportError>;
}

export class CodexImport extends ServiceMap.Service<CodexImport, CodexImportShape>()(
  "t3/codexImport/Services/CodexImport",
) {}
