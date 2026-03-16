import { describe, expect, it } from "vitest";
import { scoreSubsequenceMatch } from "./fuzzySearch";

describe("scoreSubsequenceMatch", () => {
  it("returns lower scores for tighter earlier matches", () => {
    expect(scoreSubsequenceMatch("beta", "bt")).toBeLessThan(
      scoreSubsequenceMatch("alphabet", "bt") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("returns null when the query is not a subsequence", () => {
    expect(scoreSubsequenceMatch("alpha", "bz")).toBeNull();
  });
});
