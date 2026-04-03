import { type TimestampFormat } from "@t3tools/contracts/settings";

export interface RelativeTimeFormatOptions {
  now?: number | Date;
  style?: "compact" | "long";
}

export function getTimestampFormatOptions(
  timestampFormat: TimestampFormat,
  includeSeconds: boolean,
): Intl.DateTimeFormatOptions {
  const baseOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
  };

  if (timestampFormat === "locale") {
    return baseOptions;
  }

  return {
    ...baseOptions,
    hour12: timestampFormat === "12-hour",
  };
}

const timestampFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getTimestampFormatter(
  timestampFormat: TimestampFormat,
  includeSeconds: boolean,
): Intl.DateTimeFormat {
  const cacheKey = `${timestampFormat}:${includeSeconds ? "seconds" : "minutes"}`;
  const cachedFormatter = timestampFormatterCache.get(cacheKey);
  if (cachedFormatter) {
    return cachedFormatter;
  }

  const formatter = new Intl.DateTimeFormat(
    undefined,
    getTimestampFormatOptions(timestampFormat, includeSeconds),
  );
  timestampFormatterCache.set(cacheKey, formatter);
  return formatter;
}

export function formatTimestamp(isoDate: string, timestampFormat: TimestampFormat): string {
  return getTimestampFormatter(timestampFormat, true).format(new Date(isoDate));
}

export function formatShortTimestamp(isoDate: string, timestampFormat: TimestampFormat): string {
  return getTimestampFormatter(timestampFormat, false).format(new Date(isoDate));
}

/**
 * Format a relative time string from an ISO date.
 * Returns `{ value: "20s", suffix: "ago" }` or `{ value: "just now", suffix: null }`
 * so callers can style the numeric portion independently.
 */
function resolveRelativeTimeNow(now?: number | Date): number {
  if (now instanceof Date) {
    return now.getTime();
  }
  if (typeof now === "number") {
    return now;
  }
  return Date.now();
}

function relativeTimeValue(
  amount: number,
  compactUnit: string,
  longSingular: string,
  style: "compact" | "long",
): string {
  if (style === "compact") {
    return `${amount}${compactUnit}`;
  }
  return `${amount} ${amount === 1 ? longSingular : `${longSingular}s`}`;
}

export function formatRelativeTime(
  isoDate: string,
  options?: RelativeTimeFormatOptions,
): { value: string; suffix: string | null } {
  const diffMs = resolveRelativeTimeNow(options?.now) - new Date(isoDate).getTime();
  if (diffMs < 0) return { value: "just now", suffix: null };
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return { value: "just now", suffix: null };
  const style = options?.style ?? "compact";
  if (seconds < 60) {
    return { value: relativeTimeValue(seconds, "s", "second", style), suffix: "ago" };
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return { value: relativeTimeValue(minutes, "m", "minute", style), suffix: "ago" };
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { value: relativeTimeValue(hours, "h", "hour", style), suffix: "ago" };
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return { value: relativeTimeValue(days, "d", "day", style), suffix: "ago" };
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return { value: relativeTimeValue(weeks, "w", "week", style), suffix: "ago" };
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return { value: relativeTimeValue(months, "mo", "month", style), suffix: "ago" };
  }
  const years = Math.floor(days / 365);
  return { value: relativeTimeValue(years, "y", "year", style), suffix: "ago" };
}

export function formatRelativeTimeLabel(isoDate: string, options?: RelativeTimeFormatOptions) {
  const relative = formatRelativeTime(isoDate, options);
  return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
}
