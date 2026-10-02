import Markdoc, { Tag, type Config, type Node } from "@markdoc/markdoc";
import { hrefForMarkdownLink } from "./nav";

export const DIAGRAM_IMAGES: Readonly<Record<string, string>> = {
  "images/protocol-overview.svg": "ProtocolOverview",
  "images/delegated-authority.svg": "DelegatedAuthority",
};

function diagramFor(node: Node | undefined): string | undefined {
  const src: unknown = node?.attributes.src;
  return typeof src === "string" ? DIAGRAM_IMAGES[src] : undefined;
}

export type TableOfContentsItem = {
  title: string;
  id: string;
  level: number;
};

export function slugifyHeading(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

export function plainText(node: Node): string {
  if (node.type === "text") return String(node.attributes.content ?? "");
  return node.children.map(plainText).join("");
}

export function collectHeadings(node: Node): TableOfContentsItem[] {
  const headings: TableOfContentsItem[] = [];
  const visit = (current: Node): void => {
    if (current.type === "heading") {
      const level = Number(current.attributes.level);
      const title = plainText(current);
      if (level >= 2 && level <= 3) {
        headings.push({ title, id: slugifyHeading(title), level });
      }
    }
    current.children.forEach(visit);
  };
  visit(node);
  return headings;
}

export const markdocConfig: Config = {
  nodes: {
    heading: {
      ...Markdoc.nodes.heading,
      transform(node, config) {
        const level = Number(node.attributes.level);
        const id = slugifyHeading(plainText(node));
        return new Tag(`h${level}`, { id }, node.transformChildren(config));
      },
    },
    link: {
      ...Markdoc.nodes.link,
      transform(node, config) {
        const href = String(node.attributes.href ?? "");
        const attributes = /^[a-z0-9-]+\.md(#.*)?$/.test(href)
          ? { ...node.attributes, href: hrefForMarkdownLink(href) }
          : node.attributes;
        return new Tag("a", attributes, node.transformChildren(config));
      },
    },
    fence: {
      ...Markdoc.nodes.fence,
      transform(node) {
        const language = String(node.attributes.language || "text");
        const content = String(node.attributes.content ?? "");
        return new Tag("CodeSample", { language, content });
      },
    },
    image: {
      ...Markdoc.nodes.image,
      transform(node, config) {
        const diagram = diagramFor(node);
        if (diagram) return new Tag(diagram);
        return new Tag("img", node.transformAttributes(config));
      },
    },
    paragraph: {
      ...Markdoc.nodes.paragraph,
      transform(node, config) {
        const inline = node.children[0];
        const image = inline?.children[0];
        if (
          node.children.length === 1 &&
          inline?.type === "inline" &&
          inline.children.length === 1 &&
          image?.type === "image" &&
          diagramFor(image)
        ) {
          return image.transform(config);
        }
        return new Tag("p", node.transformAttributes(config), node.transformChildren(config));
      },
    },
  },
  tags: {
    callout: {
      render: "aside",
      attributes: {
        type: {
          type: String,
          default: "note",
          matches: ["note", "warning"],
        },
      },
      transform(node, config) {
        const type = String(node.attributes.type || "note");
        return new Tag(
          "aside",
          { className: `callout callout-${type}`, "data-callout": type },
          node.transformChildren(config),
        );
      },
    },
  },
};
