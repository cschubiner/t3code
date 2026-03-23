import type { ThreadId } from "@t3tools/contracts";
import { toString as mdastToString } from "mdast-util-to-string";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

import type { ProposedPlan, Thread } from "../types";

export type ThreadSearchContentSourceKind = "message" | "proposed-plan";
export type ThreadSearchSourceKind =
  | "title"
  | "message-user"
  | "message-assistant"
  | "proposed-plan";

export interface ThreadSearchSource {
  threadId: ThreadId;
  threadTitle: string;
  projectId: Thread["projectId"];
  kind: ThreadSearchSourceKind;
  sourceKind: "title" | ThreadSearchContentSourceKind;
  sourceId: string;
  createdAt: string;
  text: string;
}

export interface ThreadSearchMatch {
  resultId: string;
  threadId: ThreadId;
  projectId: Thread["projectId"];
  threadTitle: string;
  kind: ThreadSearchSourceKind;
  sourceKind: "title" | ThreadSearchContentSourceKind;
  sourceId: string;
  sourceCreatedAt: string;
  matchStart: number;
  matchEnd: number;
  occurrenceIndexInSource: number;
  matchedText: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const markdownTextProcessor = unified().use(remarkParse).use(remarkGfm);

export function extractVisibleMarkdownText(markdown: string): string {
  if (markdown.trim().length === 0) {
    return "";
  }
  try {
    const tree = markdownTextProcessor.parse(markdown);
    return normalizeWhitespace(mdastToString(tree));
  } catch {
    return normalizeWhitespace(markdown);
  }
}

export function resolveThreadRecencyIso(thread: Thread): string {
  return (
    thread.latestTurn?.completedAt ??
    thread.latestTurn?.startedAt ??
    thread.session?.updatedAt ??
    thread.createdAt
  );
}

export function buildThreadSearchSources(
  thread: Thread,
  options?: { includeTitle?: boolean },
): ThreadSearchSource[] {
  const sources: ThreadSearchSource[] = [];
  if (options?.includeTitle ?? false) {
    const title = thread.title.trim();
    if (title.length > 0) {
      sources.push({
        threadId: thread.id,
        threadTitle: thread.title,
        projectId: thread.projectId,
        kind: "title",
        sourceKind: "title",
        sourceId: `title:${thread.id}`,
        createdAt: resolveThreadRecencyIso(thread),
        text: title,
      });
    }
  }

  for (const message of thread.messages) {
    if (message.role === "user") {
      const text = message.text.trim();
      if (text.length === 0) continue;
      sources.push({
        threadId: thread.id,
        threadTitle: thread.title,
        projectId: thread.projectId,
        kind: "message-user",
        sourceKind: "message",
        sourceId: message.id,
        createdAt: message.createdAt,
        text,
      });
      continue;
    }

    if (message.role === "assistant") {
      const text = extractVisibleMarkdownText(message.text);
      if (text.length === 0) continue;
      sources.push({
        threadId: thread.id,
        threadTitle: thread.title,
        projectId: thread.projectId,
        kind: "message-assistant",
        sourceKind: "message",
        sourceId: message.id,
        createdAt: message.createdAt,
        text,
      });
    }
  }

  for (const proposedPlan of thread.proposedPlans) {
    const text = extractVisibleMarkdownText(proposedPlan.planMarkdown);
    if (text.length === 0) continue;
    sources.push({
      threadId: thread.id,
      threadTitle: thread.title,
      projectId: thread.projectId,
      kind: "proposed-plan",
      sourceKind: "proposed-plan",
      sourceId: proposedPlan.id,
      createdAt: proposedPlan.createdAt,
      text,
    });
  }

  return sources;
}

export function findTextOccurrences(
  text: string,
  query: string,
): Array<{ start: number; end: number }> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return [];
  }
  const normalizedText = text.toLocaleLowerCase();
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

export function buildThreadSearchMatches(
  sources: readonly ThreadSearchSource[],
  query: string,
): ThreadSearchMatch[] {
  const matches: ThreadSearchMatch[] = [];
  for (const source of sources) {
    const sourceMatches = findTextOccurrences(source.text, query);
    sourceMatches.forEach((match, occurrenceIndexInSource) => {
      matches.push({
        resultId: `${source.threadId}:${source.sourceId}:${occurrenceIndexInSource}`,
        threadId: source.threadId,
        projectId: source.projectId,
        threadTitle: source.threadTitle,
        kind: source.kind,
        sourceKind: source.sourceKind,
        sourceId: source.sourceId,
        sourceCreatedAt: source.createdAt,
        matchStart: match.start,
        matchEnd: match.end,
        occurrenceIndexInSource,
        matchedText: source.text,
      });
    });
  }
  return matches;
}

export function createThreadSearchSnippet(
  text: string,
  start: number,
  end: number,
  radius = 54,
): string {
  const prefixStart = Math.max(0, start - radius);
  const suffixEnd = Math.min(text.length, end + radius);
  const prefix = text.slice(prefixStart, start).trimStart();
  const match = text.slice(start, end);
  const suffix = text.slice(end, suffixEnd).trimEnd();
  return `${prefixStart > 0 ? "…" : ""}${prefix}${match}${suffix}${suffixEnd < text.length ? "…" : ""}`;
}

export interface HighlightSegment {
  key: string;
  text: string;
  highlighted: boolean;
}

export function buildHighlightSegments(
  text: string,
  occurrences: readonly { start: number; end: number }[],
): HighlightSegment[] {
  if (occurrences.length === 0) {
    return [{ key: "0:end:0", text, highlighted: false }];
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const occurrence of occurrences) {
    if (occurrence.start > cursor) {
      segments.push({
        key: `${cursor}:${occurrence.start}:0`,
        text: text.slice(cursor, occurrence.start),
        highlighted: false,
      });
    }
    if (occurrence.end > occurrence.start) {
      segments.push({
        key: `${occurrence.start}:${occurrence.end}:1`,
        text: text.slice(occurrence.start, occurrence.end),
        highlighted: true,
      });
    }
    cursor = occurrence.end;
  }
  if (cursor < text.length) {
    segments.push({
      key: `${cursor}:${text.length}:0`,
      text: text.slice(cursor),
      highlighted: false,
    });
  }
  return segments;
}

export function buildProposedPlanSearchSource(
  thread: Thread,
  proposedPlan: ProposedPlan,
): ThreadSearchSource | null {
  const text = extractVisibleMarkdownText(proposedPlan.planMarkdown);
  if (text.length === 0) {
    return null;
  }
  return {
    threadId: thread.id,
    threadTitle: thread.title,
    projectId: thread.projectId,
    kind: "proposed-plan",
    sourceKind: "proposed-plan",
    sourceId: proposedPlan.id,
    createdAt: proposedPlan.createdAt,
    text,
  };
}
