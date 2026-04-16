import type { SnippetListResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureLocalApi } from "../localApi";

export const snippetQueryKeys = {
  all: ["snippets"] as const,
  list: () => ["snippets", "list"] as const,
};

const EMPTY_SNIPPET_LIST_RESULT: SnippetListResult = {
  snippets: [],
};

export function snippetListQueryOptions() {
  return queryOptions({
    queryKey: snippetQueryKeys.list(),
    queryFn: async () => {
      const api = ensureLocalApi();
      return api.snippets.list();
    },
    // Keep data around but refetch on window focus + component remount so
    // opening the snippet picker dialog always shows the latest server state.
    // The snippet library is server-side truth; in-flight mutations also
    // invalidate this key explicitly, so the network cost is minimal.
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: EMPTY_SNIPPET_LIST_RESULT,
  });
}
