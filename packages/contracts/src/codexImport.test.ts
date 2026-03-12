import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  CodexImportListSessionsInput,
  CodexImportPeekSessionInput,
  WebSocketRequest,
  WS_METHODS,
} from "./index";

const decodeListSessionsInput = Schema.decodeUnknownEffect(CodexImportListSessionsInput);
const decodePeekSessionInput = Schema.decodeUnknownEffect(CodexImportPeekSessionInput);
const decodeWebSocketRequest = Schema.decodeUnknownEffect(WebSocketRequest);

it.effect("decodes Codex import list defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeListSessionsInput({});
    assert.strictEqual(parsed.kind, "direct");
  }),
);

it.effect("trims Codex import peek session input", () =>
  Effect.gen(function* () {
    const parsed = yield* decodePeekSessionInput({
      homePath: " ~/.codex-alt ",
      sessionId: " session-1 ",
      messageCount: 10,
    });
    assert.strictEqual(parsed.homePath, "~/.codex-alt");
    assert.strictEqual(parsed.sessionId, "session-1");
  }),
);

it.effect("accepts codexImport.listSessions websocket requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-1",
      body: {
        _tag: WS_METHODS.codexImportListSessions,
        kind: "all",
        limit: 100,
      },
    });

    assert.strictEqual(parsed.body._tag, WS_METHODS.codexImportListSessions);
  }),
);
