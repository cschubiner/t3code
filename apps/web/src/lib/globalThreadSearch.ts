import type { Project, Thread } from "../types";
import {
  buildThreadSearchMatches,
  buildThreadSearchSources,
  createThreadSearchSnippet,
} from "./threadSearch";
import type { ThreadSearchDialogResult, ThreadSearchDialogResults } from "./threadSearchSurface";

export const GLOBAL_THREAD_SEARCH_RESULT_LIMIT = 300;

export type GlobalThreadSearchResult = ThreadSearchDialogResult;
export type GlobalThreadSearchResults = ThreadSearchDialogResults;

export function buildGlobalThreadSearchResults(input: {
  threads: readonly Thread[];
  projects: readonly Project[];
  query: string;
  limit?: number;
}): GlobalThreadSearchResults {
  const normalizedQuery = input.query.trim();
  if (normalizedQuery.length === 0) {
    return {
      results: [],
      totalResults: 0,
      truncated: false,
    };
  }

  const projectNameById = new Map(
    input.projects.map((project) => [project.id, project.name] as const),
  );
  const resultsByThreadId = new Map<Thread["id"], GlobalThreadSearchResult>();

  for (const thread of input.threads) {
    const sources = buildThreadSearchSources(thread, { includeTitle: true });
    const matches = buildThreadSearchMatches(sources, normalizedQuery);
    if (matches.length === 0) {
      continue;
    }
    const projectName = projectNameById.get(thread.projectId) ?? "Unknown project";
    const representativeMatch = matches.toSorted((left, right) => {
      const byCreatedAt = right.sourceCreatedAt.localeCompare(left.sourceCreatedAt);
      if (byCreatedAt !== 0) return byCreatedAt;
      const bySourceId = right.sourceId.localeCompare(left.sourceId);
      if (bySourceId !== 0) return bySourceId;
      return left.occurrenceIndexInSource - right.occurrenceIndexInSource;
    })[0];
    if (!representativeMatch) {
      continue;
    }
    resultsByThreadId.set(thread.id, {
      ...representativeMatch,
      projectName,
      matchCount: matches.length,
      displaySnippet:
        representativeMatch.kind === "title"
          ? thread.title
          : createThreadSearchSnippet(
              representativeMatch.matchedText,
              representativeMatch.matchStart,
              representativeMatch.matchEnd,
            ),
    });
  }

  const unsortedResults = Array.from(resultsByThreadId.values());

  unsortedResults.sort((left, right) => {
    const byCreatedAt = right.sourceCreatedAt.localeCompare(left.sourceCreatedAt);
    if (byCreatedAt !== 0) return byCreatedAt;
    const byThreadId = right.threadId.localeCompare(left.threadId);
    if (byThreadId !== 0) return byThreadId;
    const bySourceId = right.sourceId.localeCompare(left.sourceId);
    if (bySourceId !== 0) return bySourceId;
    return left.occurrenceIndexInSource - right.occurrenceIndexInSource;
  });

  const limit = input.limit ?? GLOBAL_THREAD_SEARCH_RESULT_LIMIT;
  return {
    results: unsortedResults.slice(0, limit),
    totalResults: unsortedResults.length,
    truncated: unsortedResults.length > limit,
  };
}
