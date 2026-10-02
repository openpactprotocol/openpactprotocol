import type { ScopeDefinition } from "./config.js";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLES = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#eef0f3;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#111827;display:flex;justify-content:center;align-items:flex-start;padding:40px 16px}
.sheet{width:100%;max-width:420px;background:#fff;border-radius:20px;box-shadow:0 1px 2px rgba(17,24,39,.06),0 12px 40px rgba(17,24,39,.10);padding:28px}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px}
.logo{width:32px;height:32px;border-radius:9px;color:#fff;display:grid;place-items:center;font-weight:700;flex:none}
.link{display:flex;align-items:center;justify-content:center;gap:10px;margin:26px 0 18px}
.link .logo,.link .pa{width:48px;height:48px;border-radius:14px;font-size:20px}
.pa{display:grid;place-items:center;background:#f3f4f6;color:#4b5563;border:1px solid #e5e7eb}
.dots{display:flex;gap:4px}
.dots i{width:4px;height:4px;border-radius:50%;background:#d1d5db}
h1{font-size:20px;line-height:1.3;margin:0 0 6px;text-align:center;font-weight:650}
.sub{color:#6b7280;font-size:13px;margin:0;text-align:center}
.sub b{color:#374151;font-weight:600}
.label{font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin:24px 0 8px}
.scopes{border:1px solid #e5e7eb;border-radius:14px;overflow:hidden}
.scope{display:flex;align-items:center;gap:12px;padding:14px;border-top:1px solid #f0f1f3;cursor:pointer}
.scope:first-child{border-top:0}
.scope:hover{background:#fafafa}
.icon{width:36px;height:36px;border-radius:10px;background:#f3f4f6;color:#374151;display:grid;place-items:center;flex:none}
.icon svg{width:18px;height:18px}
.scope-body{flex:1;min-width:0}
.scope-title{font-weight:600;font-size:14px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.scope-detail{color:#6b7280;font-size:13px}
.badge{font-size:11px;font-weight:600;background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:999px}
.toggle{position:relative;width:44px;height:26px;flex:none}
.toggle input{position:absolute;opacity:0;width:0;height:0}
.toggle span{position:absolute;inset:0;background:#d1d5db;border-radius:999px;transition:background .15s}
.toggle span::after{content:"";position:absolute;width:22px;height:22px;left:2px;top:2px;background:#fff;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s}
.toggle input:checked+span{background:#34c759}
.toggle input:checked+span::after{transform:translateX(18px)}
.toggle input:focus-visible+span{outline:2px solid #2563eb;outline-offset:2px}
.actions{display:grid;gap:10px;margin-top:22px}
button{width:100%;border-radius:12px;padding:13px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer}
.allow{border:0;color:#fff}
.allow:disabled{opacity:.45;cursor:default}
.deny{background:#fff;color:#374151;border:1px solid #d1d5db}
.deny:hover{background:#f9fafb}
details{margin-top:18px;font-size:12px;color:#6b7280}
summary{cursor:pointer}
details code{display:block;margin-top:6px;font-size:11px;color:#6b7280}
.foot{text-align:center;color:#9ca3af;font-size:12px;margin:18px 0 0}
`;

const ICONS: Record<string, string> = {
  upcoming:
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  writes:
    '<path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/><path d="M16 16h5v5"/>',
  default: '<circle cx="12" cy="12" r="3"/>',
};

function scopeIcon(scope: ScopeDefinition): string {
  const key = scope.writes
    ? "writes"
    : (["history", "upcoming"].find((name) => scope.id.includes(name)) ?? "default");
  return `<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg></span>`;
}

// "demo-pa" -> "Demo personal agent". Registered platform names are slugs.
export function displayName(platformName: string): string {
  if (!/^[a-z0-9-]+$/.test(platformName)) return platformName;
  const words = platformName.replace(/-pa$/, " personal agent").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLES}</style></head><body><main class="sheet">${body}</main></body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors 'none'",
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
  const color = escapeHtml(input.color);
  const rows = requested
    .map(
      (scope) => `<label class="scope" title="${escapeHtml(scope.id)}">
  ${scopeIcon(scope)}
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
    `<div class="brand"><span class="logo" style="background:${color}">${escapeHtml(input.brandName.charAt(0))}</span>${escapeHtml(input.brandName)}</div>
<div class="link" aria-hidden="true"><span class="pa">&#10022;</span><span class="dots"><i></i><i></i><i></i></span><span class="logo" style="background:${color}">${escapeHtml(input.brandName.charAt(0))}</span></div>
<h1>${escapeHtml(agent)} wants to access your ${escapeHtml(input.brandName)} account</h1>
<p class="sub">Signed in as <b>${escapeHtml(input.email)}</b><br>Agent from ${escapeHtml(input.platformOrigin)}</p>
<form method="post" action="${escapeHtml(input.action)}" id="consent">
  <input type="hidden" name="session" value="${escapeHtml(input.session)}">
  <div class="label">It will be able to</div>
  <div class="scopes">${rows}</div>
  <div class="actions">
    <button class="allow" style="background:${color}" type="submit" name="decision" value="allow" id="allow">Allow ${requested.length} of ${requested.length}</button>
    <button class="deny" type="submit" name="decision" value="deny">Don't allow</button>
  </div>
</form>
<details><summary>Scope IDs</summary>${requested.map((scope) => `<code>${escapeHtml(scope.id)}</code>`).join("")}</details>
<p class="foot">${escapeHtml(agent)} never sees your password. Revoke access anytime in ${escapeHtml(input.brandName)} settings. Powered by ${escapeHtml(input.providerName)}.</p>
<script>
const boxes=[...document.querySelectorAll('input[name=scope]')];const allow=document.getElementById('allow');
function update(){const n=boxes.filter(b=>b.checked).length;allow.textContent='Allow '+n+' of '+boxes.length;allow.disabled=n===0;}
boxes.forEach(b=>b.addEventListener('change',update));
</script>`,
  );
}
