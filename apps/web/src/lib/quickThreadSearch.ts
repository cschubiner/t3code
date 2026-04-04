import type { MessageId } from "@t3tools/contracts";

import type { Project, Thread } from "../types";
import { sortThreadsForRecentSidebar } from "./threadRecency";
import { createThreadSearchSnippet } from "./threadSearch";
import type { ThreadSearchDialogResult, ThreadSearchDialogResults } from "./threadSearchSurface";

export const QUICK_THREAD_SEARCH_RECENT_LIMIT = 100;
export const QUICK_THREAD_SEARCH_RESULT_LIMIT = 100;
const TITLE_MATCH_WEIGHT = 3;

interface QuickThreadSearchIndexEntry {
  threadId: Thread["id"];
  projectId: Thread["projectId"];
  projectName: string;
  threadTitle: string;
  threadTitleLower: string;
  threadRecencyIso: string;
  firstUserMessageId: MessageId | null;
  firstUserMessageText: string;
  firstUserMessageLower: string;
}

function weightedMatchScore(input: {
  titleMatchCount: number;
  firstUserMatchCount: number;
}): number {
  return input.titleMatchCount * TITLE_MATCH_WEIGHT + input.firstUserMatchCount;
}

function findNormalizedTextOccurrences(
  normalizedText: string,
  normalizedQuery: string,
): Array<{ start: number; end: number }> {
  if (normalizedQuery.length === 0) {
    return [];
  }

  const matches: Array<{ start: number; end: number }> = [];
  let startIndex = 0;
  while (startIndex < normalizedText.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, startIndex);
    if (matchIndex === -1) {
      break;
    }
    matches.push({ start: matchIndex, end: matchIndex + normalizedQuery.length });
    startIndex = matchIndex + normalizedQuery.length;
  }
  return matches;
}

export function buildQuickThreadSearchIndex(input: {
  threads: readonly Thread[];
  projects: readonly Project[];
  recentLimit?: number;
}): QuickThreadSearchIndexEntry[] {
  const projectNameById = new Map(
    input.projects.map((project) => [project.id, project.name] as const),
  );
  const recentThreads = sortThreadsForRecentSidebar(input.threads).slice(
    0,
    input.recentLimit ?? QUICK_THREAD_SEARCH_RECENT_LIMIT,
  );

  return recentThreads.map((thread) => {
    const firstUserMessage =
      thread.messages.find(
        (message) => message.role === "user" && message.text.trim().length > 0,
      ) ?? null;
    const firstUserMessageText = firstUserMessage?.text.trim() ?? "";

    return {
      threadId: thread.id,
      projectId: thread.projectId,
      projectName: projectNameById.get(thread.projectId) ?? "Unknown project",
      threadTitle: thread.title,
      threadTitleLower: thread.title.toLocaleLowerCase(),
      threadRecencyIso: thread.updatedAt ?? thread.createdAt,
      firstUserMessageId: firstUserMessage?.id ?? null,
      firstUserMessageText,
      firstUserMessageLower: firstUserMessageText.toLocaleLowerCase(),
    };
  });
}

export function buildQuickThreadSearchResults(input: {
  index: readonly QuickThreadSearchIndexEntry[];
  query: string;
  limit?: number;
}): ThreadSearchDialogResults {
  const normalizedQuery = input.query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return {
      results: [],
      totalResults: 0,
      truncated: false,
    };
  }

  const results: Array<
    ThreadSearchDialogResult & { weightedScore: number; titleMatched: boolean }
  > = [];

  for (const entry of input.index) {
    const titleMatches = findNormalizedTextOccurrences(entry.threadTitleLower, normalizedQuery);
    const firstUserMatches = findNormalizedTextOccurrences(
      entry.firstUserMessageLower,
      normalizedQuery,
    );
    if (titleMatches.length === 0 && firstUserMatches.length === 0) {
      continue;
    }

    const preferredMatch = titleMatches[0] ?? firstUserMatches[0];
    if (!preferredMatch) {
      continue;
    }

    const titleMatched = titleMatches.length > 0;
    const sourceId = titleMatched
      ? `title:${entry.threadId}`
      : (entry.firstUserMessageId ?? (`title:${entry.threadId}` as MessageId));
    const matchedText = titleMatched ? entry.threadTitle : entry.firstUserMessageText;
    const weightedScore = weightedMatchScore({
      titleMatchCount: titleMatches.length,
      firstUserMatchCount: firstUserMatches.length,
    });

    results.push({
      resultId: `${entry.threadId}:${sourceId}:0`,
      threadId: entry.threadId,
      projectId: entry.projectId,
      threadTitle: entry.threadTitle,
      kind: titleMatched ? "title" : "message-user",
      sourceKind: titleMatched ? "title" : "message",
      sourceId,
      sourceCreatedAt: entry.threadRecencyIso,
      matchStart: preferredMatch.start,
      matchEnd: preferredMatch.end,
      occurrenceIndexInSource: 0,
      matchedText,
      projectName: entry.projectName,
      displaySnippet: titleMatched
        ? entry.threadTitle
        : createThreadSearchSnippet(
            entry.firstUserMessageText,
            preferredMatch.start,
            preferredMatch.end,
          ),
      matchCount: titleMatches.length + firstUserMatches.length,
      weightedScore,
      titleMatched,
    });
  }

  results.sort((left, right) => {
    const byWeightedScore = right.weightedScore - left.weightedScore;
    if (byWeightedScore !== 0) return byWeightedScore;

    const byTitleMatch = Number(right.titleMatched) - Number(left.titleMatched);
    if (byTitleMatch !== 0) return byTitleMatch;

    const byRecency = right.sourceCreatedAt.localeCompare(left.sourceCreatedAt);
    if (byRecency !== 0) return byRecency;

    return right.threadId.localeCompare(left.threadId);
  });

  const limit = input.limit ?? QUICK_THREAD_SEARCH_RESULT_LIMIT;
  return {
    results: results.slice(0, limit),
    totalResults: results.length,
    truncated: results.length > limit,
  };
}
