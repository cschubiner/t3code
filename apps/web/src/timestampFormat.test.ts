import { describe, expect, it } from "vitest";

import {
  formatRelativeTime,
  formatRelativeTimeLabel,
  getTimestampFormatOptions,
} from "./timestampFormat";

describe("getTimestampFormatOptions", () => {
  it("omits hour12 when locale formatting is requested", () => {
    expect(getTimestampFormatOptions("locale", true)).toEqual({
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  });

  it("builds a 12-hour formatter with seconds when requested", () => {
    expect(getTimestampFormatOptions("12-hour", true)).toEqual({
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  });

  it("builds a 24-hour formatter without seconds when requested", () => {
    expect(getTimestampFormatOptions("24-hour", false)).toEqual({
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-03-16T12:00:00.000Z");

  it("returns compact relative labels", () => {
    expect(
      formatRelativeTime("2026-03-16T11:59:58.000Z", {
        now,
      }),
    ).toEqual({ value: "just now", suffix: null });
    expect(
      formatRelativeTime("2026-03-16T11:59:10.000Z", {
        now,
      }),
    ).toEqual({ value: "50s", suffix: "ago" });
    expect(
      formatRelativeTime("2026-03-16T11:15:00.000Z", {
        now,
      }),
    ).toEqual({ value: "45m", suffix: "ago" });
    expect(
      formatRelativeTime("2026-03-16T09:00:00.000Z", {
        now,
      }),
    ).toEqual({ value: "3h", suffix: "ago" });
    expect(
      formatRelativeTime("2026-03-13T12:00:00.000Z", {
        now,
      }),
    ).toEqual({ value: "3d", suffix: "ago" });
  });

  it("returns long relative labels for search surfaces", () => {
    expect(
      formatRelativeTimeLabel("2026-03-16T11:00:00.000Z", {
        now,
        style: "long",
      }),
    ).toBe("1 hour ago");
    expect(
      formatRelativeTimeLabel("2026-03-14T12:00:00.000Z", {
        now,
        style: "long",
      }),
    ).toBe("2 days ago");
    expect(
      formatRelativeTimeLabel("2026-02-16T12:00:00.000Z", {
        now,
        style: "long",
      }),
    ).toBe("4 weeks ago");
  });
});
