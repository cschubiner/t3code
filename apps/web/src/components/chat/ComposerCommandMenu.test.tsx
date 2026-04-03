import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerCommandMenu } from "./ComposerCommandMenu";

describe("ComposerCommandMenu", () => {
  it("renders skill labels before metadata so long titles can use the full content width", () => {
    const skillLabel = "$extremely-long-skill-title-that-should-stay-readable";
    const html = renderToStaticMarkup(
      <ComposerCommandMenu
        items={[
          {
            id: "skill:extra-root:long-title:/tmp/custom/SKILL.md",
            type: "skill",
            name: "extremely-long-skill-title-that-should-stay-readable",
            source: "extra-root",
            label: skillLabel,
            description: "Extra root · A custom skill with a long display title",
          },
        ]}
        resolvedTheme="light"
        isLoading={false}
        triggerKind="skill"
        activeItemId="skill:extra-root:long-title:/tmp/custom/SKILL.md"
        onHighlightedItemChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(html).toContain("break-all whitespace-normal");
    expect(html.indexOf(`>${skillLabel}</p>`)).toBeGreaterThanOrEqual(0);
    expect(html.indexOf(`>${skillLabel}</p>`)).toBeLessThan(html.indexOf(">skill<"));
    expect(html.indexOf(">skill<")).toBeLessThan(html.indexOf("Extra root"));
    expect(html).toContain(">custom<");
  });
});
