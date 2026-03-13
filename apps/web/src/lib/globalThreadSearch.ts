import type { Project, Thread } from "../types";
import {
  buildThreadSearchMatches,
  buildThreadSearchSources,
  createThreadSearchSnippet,
  type ThreadSearchMatch,
} from "./threadSearch";

export const GLOBAL_THREAD_SEARCH_RESULT_LIMIT = 300;

export interface GlobalThreadSearchResult extends ThreadSearchMatch {
  projectName: string;
  displaySnippet: string;
}

export interface GlobalThreadSearchResults {
  results: GlobalThreadSearchResult[];
  totalResults: number;
  truncated: boolean;
}

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
  const unsortedResults: GlobalThreadSearchResult[] = [];

  for (const thread of input.threads) {
    const sources = buildThreadSearchSources(thread, { includeTitle: true });
    const matches = buildThreadSearchMatches(sources, normalizedQuery);
    const projectName = projectNameById.get(thread.projectId) ?? "Unknown project";
    for (const match of matches) {
      unsortedResults.push({
        ...match,
        projectName,
        displaySnippet:
          match.kind === "title"
            ? thread.title
            : createThreadSearchSnippet(match.matchedText, match.matchStart, match.matchEnd),
      });
    }
  }

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
