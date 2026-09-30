import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Markdoc, { type Node } from "@markdoc/markdoc";
import { findPageByHref, navigationPages, type DocNavigationPage } from "./nav";
import { collectHeadings, markdocConfig, type TableOfContentsItem } from "./markdoc";

export type DocFrontmatter = {
  title: string;
  description: string;
};

export type DocContent = {
  frontmatter: DocFrontmatter;
  markdown: string;
  ast: Node;
  tableOfContents: TableOfContentsItem[];
};

function contentDirectory(): string {
  const fromWorkspaceRoot = resolve(process.cwd(), "docs");
  if (existsSync(fromWorkspaceRoot)) return fromWorkspaceRoot;
  const fromAppDirectory = resolve(process.cwd(), "../docs");
  if (existsSync(fromAppDirectory)) return fromAppDirectory;
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../docs");
}

export function parseFrontmatter(source: string): {
  frontmatter: DocFrontmatter;
  markdown: string;
} {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match?.[1] || match[2] === undefined) {
    throw new Error("Content page must start with title and description frontmatter");
  }

  const values: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`Invalid frontmatter line: ${line}`);
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    if (key !== "title" && key !== "description") {
      throw new Error(`Unsupported frontmatter key: ${key}`);
    }
    values[key] = value;
  }

  if (!values.title || !values.description) {
    throw new Error("Content frontmatter requires title and description");
  }
  return {
    frontmatter: { title: values.title, description: values.description },
    markdown: match[2],
  };
}

export function readDocContent(file: string): DocContent {
  const source = readFileSync(join(contentDirectory(), file), "utf8");
  const parsed = parseFrontmatter(source);
  const ast = Markdoc.parse(parsed.markdown);
  return {
    ...parsed,
    ast,
    tableOfContents: collectHeadings(ast),
  };
}

export function resolveDocPage(href: string): {
  navigation: DocNavigationPage;
  content: DocContent;
} | null {
  const page = findPageByHref(href);
  if (!page) return null;
  return { navigation: page, content: readDocContent(page.file) };
}

export function staticPageParams(): Array<{ slug: string[] }> {
  return navigationPages.map((page) => ({
    slug: page.href === "/" ? [] : page.href.slice(1).split("/"),
  }));
}

export function allContentFiles(directory = contentDirectory()): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return allContentFiles(path);
    return entry.isFile() && entry.name.endsWith(".md")
      ? [relative(contentDirectory(), path).split("\\").join("/")]
      : [];
  });
}

export function validateContent(content: DocContent): string[] {
  return Markdoc.validate(content.ast, markdocConfig).map((error) => error.error.message);
}
