import type { ReactNode } from "react";

export function Layout({
  title,
  children,
  continueScript = false,
  demoOrigin,
}: {
  title: string;
  children: ReactNode;
  continueScript?: boolean;
  demoOrigin?: { host: string; owner: string };
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href="/static/styles.css" />
      </head>
      <body>
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
        {continueScript && <script src="/static/continue.js" defer />}
      </body>
    </html>
  );
}
