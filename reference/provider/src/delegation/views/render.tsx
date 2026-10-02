import type { ReactElement } from "react";

export async function renderPage(element: ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return "<!doctype html>" + renderToStaticMarkup(element);
}
