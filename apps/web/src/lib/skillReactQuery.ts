import type { SkillSearchResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const skillQueryKeys = {
  all: ["skills"] as const,
  search: (
    cwd: string | null,
    query: string,
    limit: number,
    codexHomePath: string,
    extraRoots: readonly string[],
  ) => ["skills", "search", cwd, query, limit, codexHomePath, [...extraRoots]] as const,
};

const DEFAULT_SKILL_SEARCH_LIMIT = 40;
const DEFAULT_SKILL_SEARCH_STALE_TIME = 15_000;
const EMPTY_SKILL_SEARCH_RESULT: SkillSearchResult = {
  skills: [],
  truncated: false,
};

export function skillSearchQueryOptions(input: {
  cwd: string | null;
  query: string;
  codexHomePath: string;
  extraRoots: readonly string[];
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SKILL_SEARCH_LIMIT;
  return queryOptions({
    queryKey: skillQueryKeys.search(
      input.cwd,
      input.query,
      limit,
      input.codexHomePath,
      input.extraRoots,
    ),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Skill search is unavailable.");
      }
      return api.skills.search({
        cwd: input.cwd,
        query: input.query,
        limit,
        ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
        ...(input.extraRoots.length > 0 ? { extraRoots: [...input.extraRoots] } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SKILL_SEARCH_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SKILL_SEARCH_RESULT,
  });
}
