import { createElement, type ReactNode } from "react";
import type { ScopeDefinition } from "./config.js";
import { ConsentPage } from "./views/ConsentPage.js";
import { ErrorPage } from "./views/ErrorPage.js";
import { Layout } from "./views/Layout.js";
import { renderPage } from "./views/render.js";

// "demo-pa" -> "Demo personal agent". Registered platform names are slugs.
export function displayName(platformName: string): string {
  if (!/^[a-z0-9-]+$/.test(platformName)) return platformName;
  const words = platformName.replace(/-pa$/, " personal agent").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function page(
  title: string,
  body: ReactNode,
  status = 200,
  options: { brandColor?: string; includeScript?: boolean } = {},
): Promise<Response> {
  return new Response(
    await renderPage(
      createElement(Layout, {
        title,
        children: body,
        ...(options.brandColor === undefined ? {} : { brandColor: options.brandColor }),
        ...(options.includeScript === undefined ? {} : { includeScript: options.includeScript }),
      }),
    ),
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

export async function errorPage(
  brandName: string,
  message: string,
  status = 400,
): Promise<Response> {
  return page(`${brandName} sign-in`, createElement(ErrorPage, { message }), status);
}

export async function consentPage(input: {
  brandName: string;
  color: string;
  providerName: string;
  platformName: string;
  platformOrigin: string;
  email: string;
  scopes: (ScopeDefinition & { requested: boolean })[];
  action: string;
  session: string;
}): Promise<Response> {
  const agent = displayName(input.platformName);
  return page(
    `${agent} wants to access your ${input.brandName} account`,
    createElement(ConsentPage, {
      brandName: input.brandName,
      providerName: input.providerName,
      agent,
      platformOrigin: input.platformOrigin,
      email: input.email,
      scopes: input.scopes,
      action: input.action,
      session: input.session,
    }),
    200,
    { brandColor: input.color, includeScript: true },
  );
}
