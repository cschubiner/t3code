import { deriveDisplayedUserMessageState } from "../lib/terminalContext";
import { buildInlineTerminalContextText } from "./chat/userMessageTerminalContexts";

const ASSISTANT_CHARS_PER_LINE_FALLBACK = 72;
const USER_CHARS_PER_LINE_FALLBACK = 56;
const LINE_HEIGHT_PX = 22;
const ASSISTANT_BASE_HEIGHT_PX = 30;
const ASSISTANT_BLOCK_GAP_HEIGHT_PX = 8;
const ASSISTANT_CODE_BLOCK_CHROME_HEIGHT_PX = 20;
const USER_BASE_HEIGHT_PX = 96;
const ATTACHMENTS_PER_ROW = 2;
// Attachment thumbnails render with `max-h-[220px]` plus ~8px row gap.
const USER_ATTACHMENT_ROW_HEIGHT_PX = 228;
const USER_BUBBLE_WIDTH_RATIO = 0.8;
const USER_BUBBLE_HORIZONTAL_PADDING_PX = 32;
const ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX = 8;
const USER_MONO_AVG_CHAR_WIDTH_PX = 8.4;
const ASSISTANT_AVG_CHAR_WIDTH_PX = 7.2;
const MIN_USER_CHARS_PER_LINE = 4;
const MIN_ASSISTANT_CHARS_PER_LINE = 20;
const ASSISTANT_MARKDOWN_ESTIMATE_CACHE_MAX_ENTRIES = 500;

interface TimelineMessageHeightInput {
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ReadonlyArray<{ id: string }>;
}

interface TimelineHeightEstimateLayout {
  timelineWidthPx: number | null;
}

interface AssistantMarkdownEstimateShape {
  blockCount: number;
  codeBlockCount: number;
  codeLineCount: number;
  textLines: string[];
}

const assistantMarkdownEstimateCache = new Map<string, AssistantMarkdownEstimateShape>();

function estimateWrappedLineCount(text: string, charsPerLine: number): number {
  if (text.length === 0) return 1;

  // Avoid allocating via split for long logs; iterate once and count wrapped lines.
  let lines = 0;
  let currentLineLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines += Math.max(1, Math.ceil(currentLineLength / charsPerLine));
      currentLineLength = 0;
      continue;
    }
    currentLineLength += 1;
  }

  lines += Math.max(1, Math.ceil(currentLineLength / charsPerLine));
  return lines;
}

function isFinitePositiveNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function estimateCharsPerLineForUser(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return USER_CHARS_PER_LINE_FALLBACK;
  const bubbleWidthPx = timelineWidthPx * USER_BUBBLE_WIDTH_RATIO;
  const textWidthPx = Math.max(bubbleWidthPx - USER_BUBBLE_HORIZONTAL_PADDING_PX, 0);
  return Math.max(MIN_USER_CHARS_PER_LINE, Math.floor(textWidthPx / USER_MONO_AVG_CHAR_WIDTH_PX));
}

function estimateCharsPerLineForAssistant(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return ASSISTANT_CHARS_PER_LINE_FALLBACK;
  const textWidthPx = Math.max(timelineWidthPx - ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX, 0);
  return Math.max(
    MIN_ASSISTANT_CHARS_PER_LINE,
    Math.floor(textWidthPx / ASSISTANT_AVG_CHAR_WIDTH_PX),
  );
}

function normalizeAssistantMarkdownLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s{0,3}(?:[-+*]|\d+\.)\s+/, "")
    .replace(/^\s{0,3}>+\s?/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    .trim();
}

function buildAssistantMarkdownEstimateShape(markdown: string): AssistantMarkdownEstimateShape {
  const cached = assistantMarkdownEstimateCache.get(markdown);
  if (cached) {
    return cached;
  }

  const textLines: string[] = [];
  let codeLineCount = 0;
  let blockCount = 0;
  let codeBlockCount = 0;
  let inCodeBlock = false;
  let currentBlockHasContent = false;

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockCount += 1;
        if (!currentBlockHasContent) {
          blockCount += 1;
          currentBlockHasContent = true;
        }
      } else {
        inCodeBlock = false;
      }
      continue;
    }

    if (trimmed.length === 0) {
      currentBlockHasContent = false;
      continue;
    }

    if (!currentBlockHasContent) {
      blockCount += 1;
      currentBlockHasContent = true;
    }

    if (inCodeBlock) {
      codeLineCount += 1;
      continue;
    }

    textLines.push(normalizeAssistantMarkdownLine(line) || trimmed);
  }

  const shape = {
    blockCount,
    codeBlockCount,
    codeLineCount,
    textLines,
  } satisfies AssistantMarkdownEstimateShape;

  assistantMarkdownEstimateCache.set(markdown, shape);
  if (assistantMarkdownEstimateCache.size > ASSISTANT_MARKDOWN_ESTIMATE_CACHE_MAX_ENTRIES) {
    const oldestKey = assistantMarkdownEstimateCache.keys().next().value;
    if (typeof oldestKey === "string") {
      assistantMarkdownEstimateCache.delete(oldestKey);
    }
  }

  return shape;
}

export function estimateTimelineMessageHeight(
  message: TimelineMessageHeightInput,
  layout: TimelineHeightEstimateLayout = { timelineWidthPx: null },
): number {
  if (message.role === "assistant") {
    const charsPerLine = estimateCharsPerLineForAssistant(layout.timelineWidthPx);
    const assistantMarkdown = buildAssistantMarkdownEstimateShape(message.text);
    const estimatedTextLines = assistantMarkdown.textLines.reduce(
      (total, line) => total + estimateWrappedLineCount(line, charsPerLine),
      0,
    );
    const estimatedLines = estimatedTextLines + assistantMarkdown.codeLineCount;
    return (
      ASSISTANT_BASE_HEIGHT_PX +
      estimatedLines * LINE_HEIGHT_PX +
      Math.max(0, assistantMarkdown.blockCount - 1) * ASSISTANT_BLOCK_GAP_HEIGHT_PX +
      assistantMarkdown.codeBlockCount * ASSISTANT_CODE_BLOCK_CHROME_HEIGHT_PX
    );
  }

  if (message.role === "user") {
    const charsPerLine = estimateCharsPerLineForUser(layout.timelineWidthPx);
    const displayedUserMessage = deriveDisplayedUserMessageState(message.text);
    const renderedText =
      displayedUserMessage.contexts.length > 0
        ? [
            buildInlineTerminalContextText(displayedUserMessage.contexts),
            displayedUserMessage.visibleText,
          ]
            .filter((part) => part.length > 0)
            .join(" ")
        : displayedUserMessage.visibleText;
    const estimatedLines = estimateWrappedLineCount(renderedText, charsPerLine);
    const attachmentCount = message.attachments?.length ?? 0;
    const attachmentRows = Math.ceil(attachmentCount / ATTACHMENTS_PER_ROW);
    const attachmentHeight = attachmentRows * USER_ATTACHMENT_ROW_HEIGHT_PX;
    return USER_BASE_HEIGHT_PX + estimatedLines * LINE_HEIGHT_PX + attachmentHeight;
  }

  // `system` messages are not rendered in the chat timeline, but keep a stable
  // explicit branch in case they are present in timeline data.
  const charsPerLine = estimateCharsPerLineForAssistant(layout.timelineWidthPx);
  const estimatedLines = estimateWrappedLineCount(message.text, charsPerLine);
  return ASSISTANT_BASE_HEIGHT_PX + estimatedLines * LINE_HEIGHT_PX;
}
