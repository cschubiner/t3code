import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DEFAULT_SERVER_SETTINGS, ServerSettings } from "./settings";

describe("ServerSettings", () => {
  it("enables assistant streaming by default when the setting is omitted", () => {
    const parsed = Schema.decodeUnknownSync(ServerSettings)({});

    expect(parsed.enableAssistantStreaming).toBe(true);
    expect(DEFAULT_SERVER_SETTINGS.enableAssistantStreaming).toBe(true);
  });

  it("preserves an explicit buffered setting", () => {
    const parsed = Schema.decodeUnknownSync(ServerSettings)({
      enableAssistantStreaming: false,
    });

    expect(parsed.enableAssistantStreaming).toBe(false);
  });
});
