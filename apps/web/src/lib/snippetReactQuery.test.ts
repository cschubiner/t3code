import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../nativeApi", () => ({
  ensureNativeApi: vi.fn(),
}));

import * as nativeApi from "../nativeApi";
import { snippetListQueryOptions, snippetQueryKeys } from "./snippetReactQuery";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("snippetQueryKeys", () => {
  it("exposes a stable list key", () => {
    expect(snippetQueryKeys.list()).toEqual(["snippets", "list"]);
  });
});

describe("snippetListQueryOptions", () => {
  it("loads snippets from the native API", async () => {
    const list = vi.fn().mockResolvedValue({
      snippets: [
        {
          id: "snippet-1",
          text: "Saved snippet",
          createdAt: "2026-04-02T18:00:00.000Z",
          updatedAt: "2026-04-02T18:00:00.000Z",
        },
      ],
    });
    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      snippets: { list },
    } as unknown as ReturnType<typeof nativeApi.ensureNativeApi>);

    const queryClient = new QueryClient();
    const result = await queryClient.fetchQuery(snippetListQueryOptions());

    expect(list).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      snippets: [
        {
          id: "snippet-1",
          text: "Saved snippet",
          createdAt: "2026-04-02T18:00:00.000Z",
          updatedAt: "2026-04-02T18:00:00.000Z",
        },
      ],
    });
  });
});
