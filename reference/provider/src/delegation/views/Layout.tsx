import type { ReactNode } from "react";

export function Layout({
  title,
  children,
  brandColor,
  includeScript = false,
  demoOrigin,
}: {
  title: string;
  children: ReactNode;
  brandColor?: string;
  includeScript?: boolean;
  demoOrigin?: { host: string; owner: string };
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href="/delegation/consent.css" />
      </head>
      <body {...(brandColor === undefined ? {} : { "data-brand-color": brandColor })}>
        {demoOrigin && (
          <div
            className="demo-origin"
            role="note"
            aria-label={`Demo: served at ${demoOrigin.host} by ${demoOrigin.owner}`}
          >
            <span className="demo-tag">DEMO</span>
            <span className="demo-lock" aria-hidden="true" />
            <span className="demo-host">{demoOrigin.host}</span>
            <span className="demo-separator" aria-hidden="true">
              ·
            </span>
            <span className="demo-owner">{demoOrigin.owner}</span>
          </div>
        )}
        <main className="sheet">{children}</main>
        {includeScript && <script src="/delegation/consent.js" defer />}
      </body>
    </html>
  );
}
