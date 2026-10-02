import type { ReactNode } from "react";

export function Layout({
  title,
  children,
  brandColor,
  includeScript = false,
}: {
  title: string;
  children: ReactNode;
  brandColor?: string;
  includeScript?: boolean;
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
        <main className="sheet">{children}</main>
        {includeScript && <script src="/delegation/consent.js" defer />}
      </body>
    </html>
  );
}
