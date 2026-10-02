import type { ReactNode } from "react";

export function Layout({
  title,
  children,
  continueScript = false,
}: {
  title: string;
  children: ReactNode;
  continueScript?: boolean;
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
        <main className="sheet">{children}</main>
        {continueScript && <script src="/static/continue.js" defer />}
      </body>
    </html>
  );
}
