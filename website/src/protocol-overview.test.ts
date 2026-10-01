import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdoc, { Tag } from "@markdoc/markdoc";
import { expect, it } from "vitest";
import { ProtocolOverviewDiagram } from "./components/protocol-overview";
import { readDocContent } from "./content";
import { markdocConfig } from "./markdoc";

function findProtocolOverview(
  tree: unknown,
  withinParagraph = false,
): { found: boolean; insideParagraph: boolean } {
  if (Array.isArray(tree)) {
    return tree.reduce(
      (result, child) => {
        const found = findProtocolOverview(child, withinParagraph);
        return {
          found: result.found || found.found,
          insideParagraph: result.insideParagraph || found.insideParagraph,
        };
      },
      { found: false, insideParagraph: false },
    );
  }

  if (!Tag.isTag(tree)) return { found: false, insideParagraph: false };
  if (tree.name === "ProtocolOverview") {
    return { found: true, insideParagraph: withinParagraph };
  }

  return findProtocolOverview(tree.children, withinParagraph || tree.name === "p");
}

it("writes the protocol overview diagram as a standalone SVG", async () => {
  await expect(
    renderToStaticMarkup(createElement(ProtocolOverviewDiagram)) + "\n",
  ).toMatchFileSnapshot("../../docs/images/protocol-overview.svg");
});

it("renders the protocol overview image outside a paragraph", () => {
  const content = readDocContent("index.md");
  const transformed = Markdoc.transform(content.ast, markdocConfig);
  const location = findProtocolOverview(transformed);

  expect(location.found).toBe(true);
  expect(location.insideParagraph).toBe(false);
});
