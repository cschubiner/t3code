import { type MessageId } from "@t3tools/contracts";
import { type TimelineEntry } from "../session-logic";

export interface ThreadMessageSearchMatch {
  readonly messageId: MessageId;
  readonly role: "user" | "assistant";
  readonly preview: string;
}

const MAX_PREVIEW_LENGTH = 96;

export function buildThreadMessageSearchMatches(
  timelineEntries: ReadonlyArray<TimelineEntry>,
  query: string,
): ThreadMessageSearchMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const matches: ThreadMessageSearchMatch[] = [];
  for (const entry of timelineEntries) {
    if (entry.kind !== "message") continue;
    if (entry.message.role !== "user" && entry.message.role !== "assistant") continue;

    const text = entry.message.text ?? "";
    if (!text.toLocaleLowerCase().includes(normalizedQuery)) {
      continue;
    }

    matches.push({
      messageId: entry.message.id,
      role: entry.message.role,
      preview: buildSearchPreview(text, normalizedQuery),
    });
  }
  return matches;
}

function buildSearchPreview(text: string, normalizedQuery: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_PREVIEW_LENGTH) {
    return collapsed;
  }

  const matchIndex = collapsed.toLocaleLowerCase().indexOf(normalizedQuery);
  if (matchIndex === -1) {
    return `${collapsed.slice(0, MAX_PREVIEW_LENGTH - 1)}…`;
  }

  const prefixLength = Math.max(0, Math.floor((MAX_PREVIEW_LENGTH - normalizedQuery.length) / 2));
  const start = Math.max(0, matchIndex - prefixLength);
  const end = Math.min(collapsed.length, start + MAX_PREVIEW_LENGTH - 1);
  return `${start > 0 ? "…" : ""}${collapsed.slice(start, end)}${end < collapsed.length ? "…" : ""}`;
}
