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
      { title: "Quickstart", href: "/quickstart", file: "quickstart.md" },
    ],
  },
  {
    title: "Protocol",
    pages: [{ title: "Specification", href: "/spec", file: "spec.md" }],
  },
  {
    title: "Reference",
    pages: [
      {
        title: "Reference implementation",
        href: "/reference-implementation",
        file: "reference-implementation.md",
      },
      { title: "TypeScript client", href: "/typescript-client", file: "typescript-client.md" },
    ],
  },
];

export const navigationPages: readonly DocNavigationPage[] = navigation.flatMap((section) => [
  ...section.pages,
]);

export function findPageByHref(href: string): DocNavigationPage | undefined {
  return navigationPages.find((page) => page.href === href);
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
