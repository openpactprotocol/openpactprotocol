import type { ScopeDefinition } from "./config.js";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function scopeIcon(scope: ScopeDefinition): string {
  return scope.writes
    ? "writes"
    : (["history", "upcoming"].find((name) => scope.id.includes(name)) ?? "default");
}

// "demo-pa" -> "Demo personal agent". Registered platform names are slugs.
export function displayName(platformName: string): string {
  if (!/^[a-z0-9-]+$/.test(platformName)) return platformName;
  const words = platformName.replace(/-pa$/, " personal agent").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function page(
  title: string,
  body: string,
  options: { brandColor?: string; includeScript?: boolean } = {},
): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/delegation/consent.css"></head><body${options.brandColor !== undefined ? ` data-brand-color="${escapeHtml(options.brandColor)}"` : ""}><main class="sheet">${body}</main>${options.includeScript ? '<script src="/delegation/consent.js" defer></script>' : ""}</body></html>`,
    {
      status: 200,
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

export function errorPage(brandName: string, message: string, status = 400): Response {
  const response = page(
    `${brandName} sign-in`,
    `<h1>Something went wrong</h1><p class="sub">${escapeHtml(message)}</p>`,
  );
  return new Response(response.body, { status, headers: response.headers });
}

export function consentPage(input: {
  brandName: string;
  color: string;
  providerName: string;
  platformName: string;
  platformOrigin: string;
  email: string;
  scopes: (ScopeDefinition & { requested: boolean })[];
  action: string;
  session: string;
}): Response {
  const requested = input.scopes.filter((scope) => scope.requested);
  const agent = displayName(input.platformName);
  const rows = requested
    .map(
      (scope) => `<label class="scope" title="${escapeHtml(scope.id)}">
  <span class="icon" aria-hidden="true"><span class="glyph glyph-${scopeIcon(scope)}"></span></span>
  <span class="scope-body">
    <span class="scope-title">${escapeHtml(scope.description)}${scope.writes ? '<span class="badge">Makes changes</span>' : ""}</span>
    <span class="scope-detail">${escapeHtml(scope.detail)}</span>
  </span>
  <span class="toggle"><input type="checkbox" name="scope" value="${escapeHtml(scope.id)}" aria-label="${escapeHtml(scope.description)}" checked><span></span></span>
</label>`,
    )
    .join("");
  return page(
    `${agent} wants to access your ${input.brandName} account`,
    `<div class="brand"><span class="logo">${escapeHtml(input.brandName.charAt(0))}</span>${escapeHtml(input.brandName)}</div>
<div class="link" aria-hidden="true"><span class="pa">&#10022;</span><span class="dots"><i></i><i></i><i></i></span><span class="logo">${escapeHtml(input.brandName.charAt(0))}</span></div>
<h1>${escapeHtml(agent)} wants to access your ${escapeHtml(input.brandName)} account</h1>
<p class="sub">Signed in as <b>${escapeHtml(input.email)}</b><br>Agent from ${escapeHtml(input.platformOrigin)}</p>
<form method="post" action="${escapeHtml(input.action)}" id="consent">
  <input type="hidden" name="session" value="${escapeHtml(input.session)}">
  <div class="label">It will be able to</div>
  <div class="scopes">${rows}</div>
  <div class="actions">
    <button class="allow" type="submit" name="decision" value="allow" id="allow">Allow ${requested.length} of ${requested.length}</button>
    <button class="deny" type="submit" name="decision" value="deny">Don't allow</button>
  </div>
</form>
<details><summary>Scope IDs</summary>${requested.map((scope) => `<code>${escapeHtml(scope.id)}</code>`).join("")}</details>
<p class="foot">${escapeHtml(agent)} never sees your password. Revoke access anytime in ${escapeHtml(input.brandName)} settings. Powered by ${escapeHtml(input.providerName)}.</p>`,
    { brandColor: input.color, includeScript: true },
  );
}
