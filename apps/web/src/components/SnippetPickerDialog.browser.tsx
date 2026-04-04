import { type Snippet, SnippetId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SnippetPickerDialog } from "./SnippetPickerDialog";

function makeSnippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: overrides.id ?? SnippetId.makeUnsafe(crypto.randomUUID()),
    text: overrides.text ?? "Saved snippet",
    createdAt: overrides.createdAt ?? "2026-04-03T16:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-03T16:00:00.000Z",
  };
}

async function mountDialog(
  options: {
    snippets?: readonly Snippet[];
    deletingSnippetId?: SnippetId | null;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);

  const onOpenChange = vi.fn();
  const onSelectSnippet = vi.fn();
  const onDeleteSnippet = vi.fn();

  const screen = await render(
    <SnippetPickerDialog
      open
      snippets={options.snippets ?? [makeSnippet()]}
      focusRequestId={1}
      deletingSnippetId={options.deletingSnippetId ?? null}
      onOpenChange={onOpenChange}
      onSelectSnippet={onSelectSnippet}
      onDeleteSnippet={onDeleteSnippet}
    />,
    { container: host },
  );

  return {
    onOpenChange,
    onSelectSnippet,
    onDeleteSnippet,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

async function waitForInput(): Promise<HTMLInputElement> {
  let input: HTMLInputElement | null = null;
  await vi.waitFor(
    () => {
      input = document.querySelector<HTMLInputElement>('[data-testid="snippet-picker-input"]');
      expect(input).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  if (!input) {
    throw new Error("Unable to find snippet picker input.");
  }
  return input;
}

function getResultRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-snippet-picker-result="true"]'));
}

describe("SnippetPickerDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("moves the highlighted snippet from the dialog keyboard flow", async () => {
    const mounted = await mountDialog({
      snippets: [
        makeSnippet({
          id: SnippetId.makeUnsafe("snippet-1"),
          text: "First saved snippet",
          updatedAt: "2026-04-03T16:00:00.000Z",
        }),
        makeSnippet({
          id: SnippetId.makeUnsafe("snippet-2"),
          text: "Second saved snippet",
          updatedAt: "2026-04-03T16:01:00.000Z",
        }),
      ],
    });

    try {
      const input = await waitForInput();
      await vi.waitFor(
        () => {
          expect(document.activeElement).toBe(input);
        },
        { timeout: 8_000, interval: 16 },
      );

      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          const results = getResultRows();
          expect(results[1]?.dataset.highlighted).toBe("true");
          expect(results[0]?.dataset.highlighted).toBeUndefined();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("selects the currently highlighted snippet when pressing enter", async () => {
    const mounted = await mountDialog({
      snippets: [
        makeSnippet({
          id: SnippetId.makeUnsafe("snippet-1"),
          text: "First saved snippet",
          updatedAt: "2026-04-03T16:00:00.000Z",
        }),
        makeSnippet({
          id: SnippetId.makeUnsafe("snippet-2"),
          text: "Second saved snippet",
          updatedAt: "2026-04-03T16:01:00.000Z",
        }),
      ],
    });

    try {
      const input = await waitForInput();
      await vi.waitFor(
        () => {
          const results = getResultRows();
          expect(results[0]?.dataset.highlighted).toBe("true");
          expect(results[0]?.textContent ?? "").toContain("Second saved snippet");
        },
        { timeout: 8_000, interval: 16 },
      );

      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(mounted.onSelectSnippet).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "snippet-2",
          text: "Second saved snippet",
        }),
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("deletes snippets from the dialog", async () => {
    const mounted = await mountDialog({
      snippets: [
        makeSnippet({
          id: SnippetId.makeUnsafe("snippet-1"),
          text: "Delete me",
        }),
      ],
    });

    try {
      await waitForInput();
      await page.getByTestId("snippet-picker-delete-snippet-1").click();
      expect(mounted.onDeleteSnippet).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "snippet-1",
          text: "Delete me",
        }),
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
