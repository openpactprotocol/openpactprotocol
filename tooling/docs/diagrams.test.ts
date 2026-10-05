import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DelegatedAuthorityDiagram } from "./components/delegated-authority";
import { ProtocolOverviewDiagram } from "./components/protocol-overview";

const diagrams: ReadonlyArray<{
  tag: string;
  image: string;
  component: ComponentType;
}> = [
  {
    tag: "ProtocolOverview",
    image: "protocol-overview.svg",
    component: ProtocolOverviewDiagram,
  },
  {
    tag: "DelegatedAuthority",
    image: "delegated-authority.svg",
    component: DelegatedAuthorityDiagram,
  },
];

describe.each(diagrams)("$tag diagram", ({ image, component }) => {
  it(`writes docs/images/${image} from the component`, async () => {
    await expect(renderToStaticMarkup(createElement(component)) + "\n").toMatchFileSnapshot(
      `../../docs/images/${image}`,
    );
  });
});
