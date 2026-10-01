import Markdoc from "@markdoc/markdoc";
import type { Metadata } from "next";
import * as React from "react";
import { notFound } from "next/navigation";
import { readDocContent, resolveDocPage, staticPageParams } from "../../content";
import { CodeSample } from "../../components/code-sample";
import { DelegatedAuthority } from "../../components/delegated-authority";
import { ProtocolOverview } from "../../components/protocol-overview";
import { SiteShell } from "../../components/site-shell";
import { findPageByHref } from "../../nav";
import { markdocConfig } from "../../markdoc";

export const dynamicParams = false;

type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

function hrefForSlug(slug?: string[]): string {
  return slug?.length ? `/${slug.join("/")}` : "/";
}

export function generateStaticParams() {
  return staticPageParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = resolveDocPage(hrefForSlug(slug));
  if (!page) return {};
  return {
    title: page.content.frontmatter.title,
    description: page.content.frontmatter.description,
  };
}

export default async function DocsPage({ params }: PageProps) {
  const { slug } = await params;
  const href = hrefForSlug(slug);
  const navigationPage = findPageByHref(href);
  if (!navigationPage) notFound();

  const content = readDocContent(navigationPage.file);
  const rendered = Markdoc.transform(content.ast, markdocConfig);
  const children = Markdoc.renderers.react(rendered, React, {
    components: { CodeSample, DelegatedAuthority, ProtocolOverview },
  });

  return (
    <SiteShell currentHref={href} tableOfContents={content.tableOfContents}>
      <div className="eyebrow">{navigationPage.title}</div>
      <h1 className="page-title">{content.frontmatter.title}</h1>
      <p className="page-description">{content.frontmatter.description}</p>
      <div className="markdown-body">{children}</div>
    </SiteShell>
  );
}
