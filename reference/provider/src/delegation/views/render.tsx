import type { ReactElement } from "react";

export async function renderPage(element: ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const markup = renderToStaticMarkup(element);
  return `<!doctype html>${markup.replace(/<form\b([^>]*)>/g, (_, attributes: string) => {
    const method = attributes.match(/\bmethod="([^"]*)"/);
    const action = attributes.match(/\baction="([^"]*)"/);
    if (!method || !action) return `<form${attributes}>`;
    const remaining = attributes.replace(/\s+method="[^"]*"/, "").replace(/\s+action="[^"]*"/, "");
    return `<form method="${method[1]}" action="${action[1]}"${remaining}>`;
  })}`;
}
