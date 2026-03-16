export interface FormatRelativeTimeOptions {
  now?: number | Date;
  style?: "compact" | "long";
}

export function formatRelativeTime(iso: string, options?: FormatRelativeTimeOptions): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return iso;
  }

  const nowValue = options?.now;
  const now =
    nowValue instanceof Date
      ? nowValue.getTime()
      : typeof nowValue === "number"
        ? nowValue
        : Date.now();
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60_000);
  const style = options?.style ?? "compact";

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return style === "long"
      ? `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
      : `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return style === "long" ? `${hours} ${hours === 1 ? "hour" : "hours"} ago` : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return style === "long" ? `${days} ${days === 1 ? "day" : "days"} ago` : `${days}d ago`;
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return style === "long" ? `${weeks} ${weeks === 1 ? "week" : "weeks"} ago` : `${weeks}w ago`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return style === "long"
      ? `${months} ${months === 1 ? "month" : "months"} ago`
      : `${months}mo ago`;
  }

  const years = Math.floor(days / 365);
  return style === "long" ? `${years} ${years === 1 ? "year" : "years"} ago` : `${years}y ago`;
}
