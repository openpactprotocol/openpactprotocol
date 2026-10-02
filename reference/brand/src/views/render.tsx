import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

export function renderPage(element: ReactElement): string {
  const markup = renderToStaticMarkup(element);
  return `<!doctype html>${markup.replace(/<form\b([^>]*)>/g, (_, attributes: string) => {
    const method = attributes.match(/\bmethod="([^"]*)"/);
    const action = attributes.match(/\baction="([^"]*)"/);
    if (!method || !action) return `<form${attributes}>`;
    const remaining = attributes.replace(/\s+method="[^"]*"/, "").replace(/\s+action="[^"]*"/, "");
    return `<form method="${method[1]}" action="${action[1]}"${remaining}>`;
  })}`;
}
