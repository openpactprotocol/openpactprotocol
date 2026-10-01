export type DocNavigationPage = {
  title: string;
  href: string;
  file: string;
};

export const navigation: ReadonlyArray<{
  title: string;
  pages: readonly DocNavigationPage[];
}> = [
  {
    title: "Overview",
    pages: [
      { title: "Introduction", href: "/", file: "index.md" },
      { title: "Build a PA integration", href: "/pa", file: "pa.md" },
      { title: "Build a Provider", href: "/provider", file: "provider.md" },
    ],
  },
  {
    title: "Protocol",
    pages: [{ title: "Specification", href: "/spec", file: "spec.md" }],
  },
  {
    title: "Reference",
    pages: [{ title: "Run the reference stack", href: "/running", file: "running.md" }],
  },
];

export const navigationPages: readonly DocNavigationPage[] = navigation.flatMap((section) => [
  ...section.pages,
]);

export function findPageByHref(href: string): DocNavigationPage | undefined {
  return navigationPages.find((page) => page.href === href);
}

export function findPageByFile(file: string): DocNavigationPage | undefined {
  return navigationPages.find((page) => page.file === file);
}

/** Maps a docs-relative markdown link (`spec.md#4-messages`) to its site route. */
export function hrefForMarkdownLink(target: string): string {
  const [file = "", fragment] = target.split("#", 2);
  const page = findPageByFile(file);
  if (!page) return target;
  return fragment ? `${page.href}#${fragment}` : page.href;
}

export function pageNeighbors(href: string): {
  previous?: DocNavigationPage;
  next?: DocNavigationPage;
} {
  const index = navigationPages.findIndex((page) => page.href === href);
  return {
    ...(index > 0 ? { previous: navigationPages[index - 1] } : {}),
    ...(index >= 0 && index < navigationPages.length - 1
      ? { next: navigationPages[index + 1] }
      : {}),
  };
}
