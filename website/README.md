# Docs site

Statically generated Next.js + Markdoc renderer for the pages in the
repository's `docs/` directory. Navigation is defined in `src/nav.ts`.

```sh
pnpm --filter @pact/docs dev     # http://localhost:3003
pnpm --filter @pact/docs build
```

To add a page: create `docs/<name>.md` with `title` and `description`
frontmatter, add it to `src/nav.ts`, and run `pnpm test` (content tests check
frontmatter, navigation coverage, Markdoc validity, and internal links).
Supported extras beyond Markdown: `{% callout type="note|warning" %}…{% /callout %}`.
