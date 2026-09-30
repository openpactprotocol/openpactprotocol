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
    title: "Getting started",
    pages: [
      { title: "Introduction", href: "/", file: "index.md" },
      { title: "How it works", href: "/how-it-works", file: "how-it-works.md" },
      { title: "Quickstart", href: "/quickstart", file: "quickstart.md" },
    ],
  },
  {
    title: "Integration guide",
    pages: [
      {
        title: "Registration",
        href: "/guides/registration",
        file: "guides/registration.md",
      },
      {
        title: "Authentication",
        href: "/guides/authentication",
        file: "guides/authentication.md",
      },
      { title: "Discovery", href: "/guides/discovery", file: "guides/discovery.md" },
      { title: "Messaging", href: "/guides/messaging", file: "guides/messaging.md" },
    ],
  },
  {
    title: "Reference",
    pages: [
      { title: "Operations", href: "/reference/operations", file: "reference/operations.md" },
      { title: "Errors", href: "/reference/errors", file: "reference/errors.md" },
      {
        title: "TypeScript client",
        href: "/reference/typescript-client",
        file: "reference/typescript-client.md",
      },
      {
        title: "Reference harness",
        href: "/reference/reference-harness",
        file: "reference/reference-harness.md",
      },
    ],
  },
] as const;

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
