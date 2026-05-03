import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ComposerPrimaryActions, formatPendingPrimaryActionLabel } from "./ComposerPrimaryActions";

describe("formatPendingPrimaryActionLabel", () => {
  it("returns 'Submitting...' while responding", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: true,
        questionIndex: 0,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submitting...' while responding regardless of other flags", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: true,
        questionIndex: 3,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submit' in compact mode on the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit");
  });

  it("returns 'Next' in compact mode when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Next");
  });

  it("returns 'Next question' when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Next question");
  });

  it("returns singular 'Submit answer' on the last question when it is the only question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit answer");
  });

  it("returns plural 'Submit answers' on the last question when there are multiple questions", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Submit answers");
  });

  it("returns plural 'Submit answers' for higher question indices", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 5,
      }),
    ).toBe("Submit answers");
  });
});

describe("ComposerPrimaryActions", () => {
  const renderRunningActions = (overrides: Partial<Parameters<typeof ComposerPrimaryActions>[0]>) =>
    renderToStaticMarkup(
      createElement(ComposerPrimaryActions, {
        compact: false,
        pendingAction: null,
        isRunning: true,
        showPlanFollowUpPrompt: false,
        promptHasText: true,
        isSendBusy: true,
        isConnecting: false,
        isPreparingWorktree: false,
        hasSendableContent: true,
        onPreviousPendingQuestion: () => {},
        onInterrupt: () => {},
        onQueueFollowUp: () => {},
        onSteerTurn: () => {},
        onImplementPlanInNewThread: () => {},
        ...overrides,
      }),
    );

  it("shows queue, steer, and stop actions while a turn is running with draft text", () => {
    const markup = renderRunningActions({});

    expect(markup).toContain('aria-label="Queue follow-up"');
    expect(markup).toContain('aria-label="Steer running turn"');
    expect(markup).toContain('aria-label="Stop generation"');
  });

  it("keeps only the stop action visible while running with an empty draft", () => {
    const markup = renderRunningActions({ promptHasText: false, hasSendableContent: false });

    expect(markup).not.toContain('aria-label="Queue follow-up"');
    expect(markup).not.toContain('aria-label="Steer running turn"');
    expect(markup).toContain('aria-label="Stop generation"');
  });
});
