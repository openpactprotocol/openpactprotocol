import { ChevronLeft, ChevronRight, ListTree } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { navigation, pageNeighbors } from "../nav";
import { BrandMark } from "./brand-mark";
import type { TableOfContentsItem } from "../markdoc";

export function SiteShell({
  children,
  currentHref,
  tableOfContents,
}: {
  children: ReactNode;
  currentHref: string;
  tableOfContents: TableOfContentsItem[];
}) {
  const neighbors = pageNeighbors(currentHref);

  return (
    <div className="site-frame">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Personal Agent Consent & Trust Protocol home">
          <BrandMark />
          <span className="brand-name">Personal Agent Consent & Trust Protocol</span>
        </Link>
        <div className="topbar-right">
          <span className="topbar-caption">Developer documentation</span>
          <a
            className="github-link"
            href="https://github.com/decagon-external/personal-agent-protocol"
            target="_blank"
            rel="noreferrer"
          >
            <span className="github-external" aria-hidden="true">
              ↗
            </span>
            <span>GitHub</span>
          </a>
        </div>
      </header>

      <div className="site-grid">
        <aside className="sidebar" aria-label="Documentation navigation">
          {navigation.map((section) => (
            <section className="nav-section" key={section.title}>
              <h2>{section.title}</h2>
              <nav>
                {section.pages.map((page) => (
                  <Link
                    className={`nav-link${page.href === currentHref ? " nav-link-active" : ""}`}
                    href={page.href}
                    key={page.href}
                    aria-current={page.href === currentHref ? "page" : undefined}
                  >
                    {page.title}
                  </Link>
                ))}
              </nav>
            </section>
          ))}
          <div className="sidebar-note">
            <span className="sidebar-note-icon">1.0</span>
            <p>Identity is implemented. Delegated authority is specified, not yet built.</p>
          </div>
        </aside>

        <div className="article-grid">
          <main className="article-main">
            <article className="article-content">{children}</article>
            <nav className="page-neighbors" aria-label="Page navigation">
              {neighbors.previous ? (
                <Link className="neighbor-card" href={neighbors.previous.href}>
                  <span className="neighbor-label">
                    <ChevronLeft size={14} aria-hidden="true" />
                    Previous
                  </span>
                  <span className="neighbor-title">{neighbors.previous.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {neighbors.next ? (
                <Link className="neighbor-card neighbor-card-next" href={neighbors.next.href}>
                  <span className="neighbor-label">
                    Next
                    <ChevronRight size={14} aria-hidden="true" />
                  </span>
                  <span className="neighbor-title">{neighbors.next.title}</span>
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </main>

          <aside className="toc" aria-label="On this page">
            <div className="toc-title">
              <ListTree size={15} aria-hidden="true" />
              On this page
            </div>
            {tableOfContents.length ? (
              <nav>
                {tableOfContents.map((item) => (
                  <a
                    className={`toc-link${item.level === 3 ? " toc-link-nested" : ""}`}
                    href={`#${item.id}`}
                    key={`${item.id}-${item.level}`}
                  >
                    {item.title}
                  </a>
                ))}
              </nav>
            ) : (
              <p className="toc-empty">No sections on this page.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
