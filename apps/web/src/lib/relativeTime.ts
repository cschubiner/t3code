export interface FormatRelativeTimeOptions {
  now?: number | Date;
  style?: "compact" | "long";
  includeSuffix?: boolean;
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
  const includeSuffix = options?.includeSuffix ?? true;

  const withSuffix = (value: string): string => (includeSuffix ? `${value} ago` : value);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return style === "long"
      ? withSuffix(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`)
      : withSuffix(`${minutes}m`);
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return style === "long"
      ? withSuffix(`${hours} ${hours === 1 ? "hour" : "hours"}`)
      : withSuffix(`${hours}h`);
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return style === "long"
      ? withSuffix(`${days} ${days === 1 ? "day" : "days"}`)
      : withSuffix(`${days}d`);
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return style === "long"
      ? withSuffix(`${weeks} ${weeks === 1 ? "week" : "weeks"}`)
      : withSuffix(`${weeks}w`);
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return style === "long"
      ? withSuffix(`${months} ${months === 1 ? "month" : "months"}`)
      : withSuffix(`${months}mo`);
  }

  const years = Math.floor(days / 365);
  return style === "long"
    ? withSuffix(`${years} ${years === 1 ? "year" : "years"}`)
    : withSuffix(`${years}y`);
}
