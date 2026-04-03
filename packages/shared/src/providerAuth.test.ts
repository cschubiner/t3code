import { describe, expect, it } from "vitest";

import { isCodexAuthErrorMessage } from "./providerAuth";

describe("isCodexAuthErrorMessage", () => {
  it("matches codex authrequired stderr payloads", () => {
    expect(
      isCodexAuthErrorMessage(
        'worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer realm=\\"OpenAI API\\"" }) invalid_token Missing or invalid access token',
      ),
    ).toBe(true);
  });

  it("matches classic not-logged-in messages", () => {
    expect(isCodexAuthErrorMessage("Codex CLI is not authenticated. Run `codex login`")).toBe(true);
    expect(isCodexAuthErrorMessage("authentication required")).toBe(true);
  });

  it("ignores unrelated provider errors", () => {
    expect(isCodexAuthErrorMessage("failed to connect to websocket")).toBe(false);
    expect(isCodexAuthErrorMessage(null)).toBe(false);
  });
});
