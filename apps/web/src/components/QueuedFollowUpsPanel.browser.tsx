import { MessageId, type ModelSelection } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import QueuedFollowUpsPanel from "./QueuedFollowUpsPanel";
import type { QueuedTurnDraft } from "../queuedTurnStore";

function makeQueuedTurn(overrides: Partial<QueuedTurnDraft> = {}): QueuedTurnDraft {
  return {
    id: MessageId.makeUnsafe(overrides.id ?? crypto.randomUUID()),
    text: overrides.text ?? "Queued follow-up",
    attachments: overrides.attachments ?? [],
    terminalContexts: overrides.terminalContexts ?? [],
    interactionMode: overrides.interactionMode ?? "default",
    runtimeMode: overrides.runtimeMode ?? "full-access",
    createdAt: overrides.createdAt ?? "2026-04-02T18:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-02T18:00:00.000Z",
    modelSelection: (overrides.modelSelection ?? null) as ModelSelection | null,
  };
}

async function mountPanel(props: Partial<ComponentProps<typeof QueuedFollowUpsPanel>> = {}) {
  const host = document.createElement("div");
  document.body.append(host);

  const onResume = vi.fn();
  const onDelete = vi.fn();
  const onClearAll = vi.fn();
  const onSaveAsSnippet = vi.fn();
  const onSaveEdit = vi.fn();
  const onSendNow = vi.fn();
  const onReorder = vi.fn();

  const screen = await render(
    <QueuedFollowUpsPanel
      queuedTurns={[
        makeQueuedTurn({ id: "turn-1", text: "First queued follow-up" }),
        makeQueuedTurn({ id: "turn-2", text: "Second queued follow-up", interactionMode: "plan" }),
      ]}
      pauseReason={null}
      blockReason="running"
      busyQueuedTurnId={null}
      isQueueInteractionDisabled={false}
      canSendNow={true}
      canResume={false}
      onResume={onResume}
      onDelete={onDelete}
      onClearAll={onClearAll}
      onSaveAsSnippet={onSaveAsSnippet}
      onSaveEdit={onSaveEdit}
      onSendNow={onSendNow}
      onReorder={onReorder}
      {...props}
    />,
    { container: host },
  );

  return {
    onResume,
    onDelete,
    onClearAll,
    onSaveAsSnippet,
    onSaveEdit,
    onSendNow,
    onReorder,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("QueuedFollowUpsPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders queue state and wires the main row controls", async () => {
    const mounted = await mountPanel();

    try {
      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("2 queued follow-ups");
        expect(text).toContain("Waiting for the current turn to finish");
        expect(text).toContain("Next: First queued follow-up");
      });

      await page.getByRole("button", { name: "Edit" }).first().click();
      const editor = page.getByRole("textbox");
      await editor.fill("Updated first queued follow-up");
      await page.getByRole("button", { name: "Save", exact: true }).click();

      expect(mounted.onSaveEdit).toHaveBeenCalledWith("turn-1", "Updated first queued follow-up");

      await page.getByRole("button", { name: "Save as snippet" }).first().click();
      expect(mounted.onSaveAsSnippet).toHaveBeenCalledWith("turn-1");

      await page.getByRole("button", { name: "Send now" }).nth(1).click();
      expect(mounted.onSendNow).toHaveBeenCalledWith("turn-2");

      await page.getByRole("button", { name: "Delete" }).nth(1).click();
      expect(mounted.onDelete).toHaveBeenCalledWith("turn-2");

      await page.getByRole("button", { name: "Clear all" }).click();
      expect(mounted.onClearAll).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows pause messaging and only resumes when allowed", async () => {
    const mounted = await mountPanel({
      pauseReason: "pending-user-input",
      blockReason: null,
      canResume: true,
    });

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain(
          "Paused until the current questions are answered",
        );
      });

      await page.getByRole("button", { name: "Resume" }).click();
      expect(mounted.onResume).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables save-as-snippet for attachment-only queued turns", async () => {
    const mounted = await mountPanel({
      queuedTurns: [
        makeQueuedTurn({
          id: "turn-1",
          text: "   ",
          attachments: [
            {
              id: "image-1",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 128,
              dataUrl: "data:image/png;base64,AAA=",
            },
          ],
        }),
      ],
    });

    try {
      await expect.element(page.getByRole("button", { name: "Save as snippet" })).toBeDisabled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables only send-now when the queue cannot dispatch yet", async () => {
    const mounted = await mountPanel({
      pauseReason: "session-error",
      blockReason: null,
      canSendNow: false,
      canResume: true,
    });

    try {
      const sendNowButton = page.getByRole("button", { name: "Send now" }).first();
      const editButton = page.getByRole("button", { name: "Edit" }).first();
      const deleteButton = page.getByRole("button", { name: "Delete" }).first();
      const resumeButton = page.getByRole("button", { name: "Resume" });

      await expect.element(sendNowButton).toBeDisabled();
      await expect.element(editButton).toBeEnabled();
      await expect.element(deleteButton).toBeEnabled();
      await expect.element(resumeButton).toBeEnabled();
    } finally {
      await mounted.cleanup();
    }
  });
});
