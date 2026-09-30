# PAC2 developer docs

This is a statically generated Next.js site. Pages are authored in
`content/**/*.md`, parsed and rendered with `@markdoc/markdoc`, and listed in
`src/nav.ts`.

## Run and build

From the repository root:

```sh
pnpm --filter @pap/docs dev
pnpm --filter @pap/docs build
pnpm --filter @pap/docs start
```

The development and production servers use port 3003. The app has no runtime
environment variables; the default Vercel Next.js preset is sufficient.

## Add a page

1. Add a Markdown file under `content/` with `title` and `description`
   frontmatter.
2. Add its title, site path, and content file path to the appropriate ordered
   section in `src/nav.ts`.
3. Link to site paths such as `/guides/messaging`; use heading fragments such
   as `#required-claims` when needed.
4. Run `pnpm test`, `pnpm --filter @pap/docs typecheck`, and
   `pnpm --filter @pap/docs build`. Content tests check frontmatter,
   navigation coverage, Markdoc validation, links, and anchors.

The optional catch-all route statically generates every path in the
navigation; unlisted paths are not dynamically rendered.

## Markdoc features

- Standard Markdown paragraphs, lists, links, tables, and blockquotes.
- Headings render with lowercase slug anchors; level-two and level-three
  headings populate the right-side table of contents.
- Fenced code blocks render as plain, copy-free code panels with a language
  label.
- `{% callout type="note" %}...{% /callout %}` and
  `{% callout type="warning" %}...{% /callout %}` render styled callouts.

The docs site is the public integration guide. The repository setup and
deployment notes remain in the root [local development](../../docs/local-development.md)
and [deployment](../../docs/deployment.md) guides.
