import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relativeTime";

describe("formatRelativeTime", () => {
  const now = new Date("2026-03-16T12:00:00.000Z");

  it("returns compact relative labels", () => {
    expect(
      formatRelativeTime("2026-03-16T11:59:10.000Z", {
        now,
      }),
    ).toBe("just now");
    expect(
      formatRelativeTime("2026-03-16T11:15:00.000Z", {
        now,
      }),
    ).toBe("45m ago");
    expect(
      formatRelativeTime("2026-03-16T09:00:00.000Z", {
        now,
      }),
    ).toBe("3h ago");
    expect(
      formatRelativeTime("2026-03-13T12:00:00.000Z", {
        now,
      }),
    ).toBe("3d ago");
  });

  it("returns long relative labels for search surfaces", () => {
    expect(
      formatRelativeTime("2026-03-16T11:00:00.000Z", {
        now,
        style: "long",
      }),
    ).toBe("1 hour ago");
    expect(
      formatRelativeTime("2026-03-14T12:00:00.000Z", {
        now,
        style: "long",
      }),
    ).toBe("2 days ago");
    expect(
      formatRelativeTime("2026-02-16T12:00:00.000Z", {
        now,
        style: "long",
      }),
    ).toBe("4 weeks ago");
  });

  it("falls back to the original value when the timestamp is invalid", () => {
    expect(formatRelativeTime("not-a-date", { now })).toBe("not-a-date");
  });
});
