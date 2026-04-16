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
    staleTime: Infinity,
    placeholderData: EMPTY_SNIPPET_LIST_RESULT,
  });
}
