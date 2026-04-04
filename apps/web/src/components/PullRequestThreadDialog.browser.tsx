import "../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

type MockResolvedPullRequest = {
  title: string;
  number: number;
  headBranch: string;
  baseBranch: string;
  state: "open" | "closed" | "merged";
};

let mockedResolvedPullRequest: MockResolvedPullRequest | null = null;
const mockedMutateAsync = vi.fn();
const mockedGetQueryData = vi.fn();

vi.mock("@tanstack/react-pacer", () => ({
  useDebouncedValue: (value: string) => [value, { state: { isPending: false } }],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    getQueryData: mockedGetQueryData,
  }),
  useQuery: () => ({
    data: mockedResolvedPullRequest ? { pullRequest: mockedResolvedPullRequest } : undefined,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
  }),
  useMutation: () => ({
    isPending: false,
    error: null,
    mutateAsync: mockedMutateAsync,
  }),
}));

vi.mock("~/lib/gitReactQuery", () => ({
  gitResolvePullRequestQueryOptions: (input: unknown) => input,
  gitPreparePullRequestThreadMutationOptions: (input: unknown) => input,
}));

import { PullRequestThreadDialog } from "./PullRequestThreadDialog";

async function mountDialog() {
  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(
    <PullRequestThreadDialog
      open
      cwd="/repo/alpha"
      initialReference="#42"
      onOpenChange={() => {}}
      onPrepared={() => {}}
    />,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("PullRequestThreadDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mockedResolvedPullRequest = null;
    mockedMutateAsync.mockReset();
    mockedGetQueryData.mockReset();
  });

  it.each([
    ["open", "text-emerald-600"],
    ["merged", "text-violet-600"],
    ["closed", "text-rose-600"],
  ] as const)(
    "renders %s pull requests with the expected status tone",
    async (state, toneClass) => {
      mockedResolvedPullRequest = {
        title: "Fix sidebar PR pill colors",
        number: 42,
        headBranch: "feature/pr-pill-colors",
        baseBranch: "main",
        state,
      };

      const mounted = await mountDialog();

      try {
        await vi.waitFor(() => {
          const status = Array.from(document.querySelectorAll("span")).find(
            (element) => element.textContent?.trim() === state,
          );

          expect(document.body.textContent).toContain("Fix sidebar PR pill colors");
          expect(status?.className).toContain(toneClass);
        });
      } finally {
        await mounted.cleanup();
      }
    },
  );
});
