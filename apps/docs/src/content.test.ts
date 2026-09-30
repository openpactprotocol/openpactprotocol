import { describe, expect, it } from "vitest";
import type { Node } from "@markdoc/markdoc";
import { allContentFiles, readDocContent, validateContent } from "./content";
import { navigationPages } from "./nav";
import { plainText, slugifyHeading } from "./markdoc";

const pages = navigationPages.map((page) => ({
  navigation: page,
  content: readDocContent(page.file),
}));

function headingIds(node: Node, result: string[] = []): string[] {
  if (node.type === "heading") result.push(slugifyHeading(plainText(node)));
  node.children.forEach((child) => headingIds(child, result));
  return result;
}

describe("developer documentation content", () => {
  it("parses and validates every Markdoc page", () => {
    for (const { content, navigation } of pages) {
      expect(validateContent(content), navigation.file).toEqual([]);
      expect(content.frontmatter.title).toBeTruthy();
      expect(content.frontmatter.description).toBeTruthy();
    }
  });

  it("maps every content file to navigation and every nav entry to a file", () => {
    const navigationFiles = navigationPages.map((page) => page.file).sort();
    expect(allContentFiles().sort()).toEqual(navigationFiles);

    for (const page of navigationPages) {
      expect(() => readDocContent(page.file)).not.toThrow();
    }
  });

  it("resolves every internal page link and heading fragment", () => {
    const pagesByHref = new Map(pages.map(({ navigation, content }) => [navigation.href, content]));

    for (const { navigation, content } of pages) {
      const markdownLinks = content.markdown.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g);
      for (const match of markdownLinks) {
        const target = match[1];
        if (!target || (!target.startsWith("/") && !target.startsWith("#"))) continue;

        const [rawPath = "", rawFragment] = target.split("#", 2);
        const pathname = rawPath ? decodeURIComponent(rawPath) : navigation.href;
        const destination = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
        const targetContent = pagesByHref.get(destination);
        expect(targetContent, `${navigation.file} links to ${target}`).toBeDefined();
        if (!targetContent || !rawFragment) continue;

        expect(headingIds(targetContent.ast), `${navigation.file} links to ${target}`).toContain(
          decodeURIComponent(rawFragment),
        );
      }
    }
  });
});
