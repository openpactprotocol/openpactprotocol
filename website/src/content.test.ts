import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const docs = resolve(process.cwd(), "docs");
const config = JSON.parse(readFileSync(resolve(docs, "docs.json"), "utf8"));
const pages: string[] = config.navigation.groups.flatMap((group: { pages: string[] }) => group.pages);
const content = new Map(pages.map((page) => [page, readFileSync(resolve(docs, `${page}.md`), "utf8")]));

function headingIds(source: string): string[] {
  return [...source.matchAll(/^#{2,6} .+? \{#([^}]+)\}$/gm)].map((match) => match[1]);
}

describe("Mintlify documentation", () => {
  it("lists every Markdown page in navigation and resolves the favicon", () => {
    expect([...pages].sort()).toEqual(
      readdirSync(docs)
        .filter((file) => file.endsWith(".md"))
        .map((file) => file.slice(0, -3))
        .sort(),
    );
    expect(existsSync(resolve(docs, config.favicon.replace(/^\//, "")))).toBe(true);
  });

  it("has metadata and unique explicit IDs for every heading", () => {
    for (const [page, source] of content) {
      expect(source, page).toMatch(/^---\ntitle: .+\ndescription: .+\n---/);
      const ids = headingIds(source);
      expect(ids.length, page).toBe([...source.matchAll(/^#{2,6} /gm)].length);
      expect(new Set(ids).size, page).toBe(ids.length);
    }
  });

  it("resolves internal page links, heading fragments and images", () => {
    for (const [page, source] of content) {
      for (const match of source.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1];
        if (/^[a-z][a-z0-9+.-]*:/.test(target)) continue;
        expect(target, page).toMatch(/^(\/|#)/);
        const [path, fragment] = target.split("#", 2);
        if (path.startsWith("/images/")) {
          expect(existsSync(resolve(docs, path.slice(1))), target).toBe(true);
          continue;
        }
        const destination = path ? path.slice(1) || "index" : page;
        const targetSource = content.get(destination);
        expect(targetSource, `${page}: ${target}`).toBeDefined();
        if (fragment && targetSource) expect(headingIds(targetSource), target).toContain(fragment);
      }
    }
  });
});
