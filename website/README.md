# Documentation hosting

Mintlify publishes the Markdown pages in `docs/`, configured by `docs/docs.json`.

## Connect Mintlify

1. Connect the `openpactprotocol/openpactprotocol` repository in Mintlify.
2. Select the production branch and set the documentation subdirectory to `/docs`.
3. Check the preview: the introduction, both integration guides, specification,
   reference-stack guide, diagrams, and specification heading links.
4. Add `pact.decagon.ai` in Mintlify and apply the DNS records it supplies.

With the Mintlify CLI installed, run `mint validate` and `mint broken-links`
from `docs/`; use `mint dev` to preview locally.

## Editing

Add pages to `docs/docs.json`. Use root-relative links without file extensions
and explicit heading IDs. The documentation tests validate navigation, metadata,
heading IDs, image paths, and internal links.

The old Next.js renderer in this directory is no longer the publishing target.
Its React diagram sources still generate `docs/images/*.svg`, which Mintlify
renders as images. To update those SVGs, edit the components in `src/components/`
and run `pnpm vitest run website/src/diagrams.test.ts -u` from the repository root.
