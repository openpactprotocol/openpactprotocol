import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

export function renderPage(element: ReactElement): string {
  return "<!doctype html>" + renderToStaticMarkup(element);
}
