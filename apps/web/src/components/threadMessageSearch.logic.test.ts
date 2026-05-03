import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { type TimelineEntry } from "../session-logic";
import { buildThreadMessageSearchMatches } from "./threadMessageSearch.logic";

describe("buildThreadMessageSearchMatches", () => {
  it("finds user and assistant message text case-insensitively", () => {
    const matches = buildThreadMessageSearchMatches(
      [
        messageEntry("user-1", "user", "Please inspect the Shortcut cluster."),
        messageEntry("assistant-1", "assistant", "The shortcut cluster is restored."),
      ],
      "shortcut",
    );

    expect(matches.map((match) => [match.messageId, match.role])).toEqual([
      [MessageId.make("user-1"), "user"],
      [MessageId.make("assistant-1"), "assistant"],
    ]);
  });

  it("returns no matches for blank queries", () => {
    expect(
      buildThreadMessageSearchMatches([messageEntry("user-1", "user", "hello")], "  "),
    ).toEqual([]);
  });
});

function messageEntry(
  id: string,
  role: "user" | "assistant",
  text: string,
): Extract<TimelineEntry, { kind: "message" }> {
  return {
    id,
    kind: "message",
    createdAt: "2026-01-01T00:00:00.000Z",
    message: {
      id: MessageId.make(id),
      role,
      text,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      streaming: false,
      turnId: null,
      attachments: [],
    },
  };
}
