import { describe, expect, it } from "vitest";

import { isCodexAuthErrorMessage } from "./providerAuth";

describe("isCodexAuthErrorMessage", () => {
  it("matches codex auth-required transport failures", () => {
    expect(
      isCodexAuthErrorMessage(
        'worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer realm=\\"OpenAI API\\"" })',
      ),
    ).toBe(true);
  });

  it("matches invalid token messages", () => {
    expect(isCodexAuthErrorMessage("Missing or invalid access token: invalid_token")).toBe(true);
  });

  it("matches codex login-required guidance", () => {
    expect(isCodexAuthErrorMessage("Not logged in. Run codex login.")).toBe(true);
  });

  it("ignores unrelated provider failures", () => {
    expect(
      isCodexAuthErrorMessage(
        "failed to connect to websocket: HTTP error: 503 Service Unavailable",
      ),
    ).toBe(false);
  });
});
