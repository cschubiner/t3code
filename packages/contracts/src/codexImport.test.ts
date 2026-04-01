import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { CodexImportListSessionsInput, CodexImportPeekSessionInput } from "./index";

const decodeListSessionsInput = Schema.decodeUnknownEffect(CodexImportListSessionsInput);
const decodePeekSessionInput = Schema.decodeUnknownEffect(CodexImportPeekSessionInput);

it.effect("decodes Codex import list defaults", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const parsed = yield* decodeListSessionsInput({});
      assert.strictEqual(parsed.kind, "direct");
    }),
  ),
);

it.effect("trims Codex import peek session input", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const parsed = yield* decodePeekSessionInput({
        homePath: " ~/.codex-alt ",
        sessionId: " session-1 ",
        messageCount: 10,
      });
      assert.strictEqual(parsed.homePath, "~/.codex-alt");
      assert.strictEqual(parsed.sessionId, "session-1");
    }),
  ),
);
