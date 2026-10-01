import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdoc, { Tag } from "@markdoc/markdoc";
import { describe, expect, it } from "vitest";
import { DelegatedAuthorityDiagram } from "./components/delegated-authority";
import { ProtocolOverviewDiagram } from "./components/protocol-overview";
import { readDocContent } from "./content";
import { markdocConfig } from "./markdoc";

type Location = { found: boolean; insideParagraph: boolean };

function findTag(tree: unknown, name: string, withinParagraph = false): Location {
  if (Array.isArray(tree)) {
    return tree.reduce<Location>(
      (result, child) => {
        const found = findTag(child, name, withinParagraph);
        return {
          found: result.found || found.found,
          insideParagraph: result.insideParagraph || found.insideParagraph,
        };
      },
      { found: false, insideParagraph: false },
    );
  }

  if (!Tag.isTag(tree)) return { found: false, insideParagraph: false };
  if (tree.name === name) return { found: true, insideParagraph: withinParagraph };

  return findTag(tree.children, name, withinParagraph || tree.name === "p");
}

const diagrams: ReadonlyArray<{
  tag: string;
  image: string;
  page: string;
  component: ComponentType;
}> = [
  {
    tag: "ProtocolOverview",
    image: "protocol-overview.svg",
    page: "index.md",
    component: ProtocolOverviewDiagram,
  },
  {
    tag: "DelegatedAuthority",
    image: "delegated-authority.svg",
    page: "spec.md",
    component: DelegatedAuthorityDiagram,
  },
];

describe.each(diagrams)("$tag diagram", ({ tag, image, page, component }) => {
  it(`writes docs/images/${image} from the component`, async () => {
    await expect(renderToStaticMarkup(createElement(component)) + "\n").toMatchFileSnapshot(
      `../../docs/images/${image}`,
    );
  });

  it(`renders the live diagram in ${page}, outside a paragraph`, () => {
    const content = readDocContent(page);
    const location = findTag(Markdoc.transform(content.ast, markdocConfig), tag);

    expect(location.found).toBe(true);
    expect(location.insideParagraph).toBe(false);
  });
});
