import type { ThreadId } from "@t3tools/contracts";

import type { Thread } from "../types";

export type ThreadSearchDialogResultKind =
  | "title"
  | "message-user"
  | "message-assistant"
  | "proposed-plan";

export interface ThreadSearchDialogResult {
  resultId: string;
  threadId: ThreadId;
  projectId: Thread["projectId"];
  threadTitle: string;
  kind: ThreadSearchDialogResultKind;
  sourceKind: "title" | "message" | "proposed-plan";
  sourceId: string;
  sourceCreatedAt: string;
  matchStart: number;
  matchEnd: number;
  occurrenceIndexInSource: number;
  matchedText: string;
  projectName: string;
  displaySnippet: string;
  matchCount: number;
}

export interface ThreadSearchDialogResults {
  results: ThreadSearchDialogResult[];
  totalResults: number;
  truncated: boolean;
}
