import "../../index.css";

import type { ComponentProps } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

async function mountComposerPrimaryActions(
  props: Partial<ComponentProps<typeof ComposerPrimaryActions>> = {},
) {
  const host = document.createElement("div");
  document.body.append(host);

  const onPreviousPendingQuestion = vi.fn();
  const onInterrupt = vi.fn();
  const onSteer = vi.fn();
  const onQueue = vi.fn();
  const onImplementPlanInNewThread = vi.fn();

  const screen = await render(
    <ComposerPrimaryActions
      compact={false}
      pendingAction={null}
      isRunning={true}
      showPlanFollowUpPrompt={false}
      canSubmit={true}
      promptHasText={true}
      isSendBusy={false}
      isConnecting={false}
      isPreparingWorktree={false}
      hasSendableContent={true}
      onPreviousPendingQuestion={onPreviousPendingQuestion}
      onInterrupt={onInterrupt}
      onSteer={onSteer}
      onQueue={onQueue}
      onImplementPlanInNewThread={onImplementPlanInNewThread}
      {...props}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    onPreviousPendingQuestion,
    onInterrupt,
    onSteer,
    onQueue,
    onImplementPlanInNewThread,
    cleanup,
  };
}

describe("ComposerPrimaryActions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps queue enabled during local-dispatch while steer remains busy", async () => {
    const mounted = await mountComposerPrimaryActions({
      isSendBusy: true,
    });

    try {
      const steerButton = page.getByRole("button", { name: "Steer" });
      const queueButton = page.getByRole("button", { name: "Queue" });

      await expect.element(steerButton).toBeDisabled();
      await expect.element(queueButton).toBeEnabled();

      await queueButton.click();
      expect(mounted.onQueue).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables queue while worktree preparation is still active", async () => {
    const mounted = await mountComposerPrimaryActions({
      isPreparingWorktree: true,
    });

    try {
      await expect.element(page.getByRole("button", { name: "Queue" })).toBeDisabled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables steer and queue when submission is structurally unavailable", async () => {
    const mounted = await mountComposerPrimaryActions({
      canSubmit: false,
    });

    try {
      await expect.element(page.getByRole("button", { name: "Steer" })).toBeDisabled();
      await expect.element(page.getByRole("button", { name: "Queue" })).toBeDisabled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables the idle send button when submission is structurally unavailable", async () => {
    const mounted = await mountComposerPrimaryActions({
      isRunning: false,
      canSubmit: false,
    });

    try {
      await expect.element(page.getByRole("button", { name: "Send message" })).toBeDisabled();
    } finally {
      await mounted.cleanup();
    }
  });
});
