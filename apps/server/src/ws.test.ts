import { describe, expect, it } from "vitest";

import { formatDispatchCommandErrorMessage } from "./ws";

describe("formatDispatchCommandErrorMessage", () => {
  it("surfaces specific orchestration invariant messages", () => {
    const error = new Error(
      "Orchestration command invariant failed (thread.create): Thread 'thread-1' already exists and cannot be created twice.",
    );

    expect(formatDispatchCommandErrorMessage(error)).toBe(error.message);
  });

  it("falls back to the generic transport message for unknown failures", () => {
    expect(formatDispatchCommandErrorMessage({ nope: true })).toBe(
      "Failed to dispatch orchestration command",
    );
  });
});
