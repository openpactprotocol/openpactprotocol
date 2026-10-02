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
body{margin:0;min-height:100vh;background:#eef0f3;font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#111827;display:flex;justify-content:center;align-items:flex-start;padding:32px 16px}
.sheet{width:100%;max-width:400px;background:#fff;border-radius:20px;box-shadow:0 10px 40px rgba(17,24,39,.12);padding:24px}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:16px}
.logo{width:32px;height:32px;border-radius:8px;color:#fff;display:grid;place-items:center;font-weight:700}
.client{display:inline-flex;align-items:center;gap:6px;margin:14px 0 4px;padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;font-size:13px;font-weight:600}
.client small{color:#6b7280;font-weight:400}
h1{font-size:22px;line-height:1.2;margin:10px 0 4px}
.muted{color:#6b7280;font-size:13px;margin:0}
.scopes{margin:18px 0;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}
.scope{display:flex;align-items:center;gap:12px;padding:12px 14px;border-top:1px solid #e5e7eb;cursor:pointer}
.scope:first-child{border-top:0}
.scope-body{flex:1;min-width:0}
.scope-title{font-weight:600;display:flex;align-items:center;gap:6px}
.scope-detail{color:#6b7280;font-size:13px}
.scope code{font-size:11px;color:#9ca3af}
.badge{font-size:10px;font-weight:600;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:999px}
.toggle{position:relative;width:46px;height:28px;flex:none}
.toggle input{opacity:0;width:0;height:0}
.toggle span{position:absolute;inset:0;background:#d1d5db;border-radius:999px;transition:.15s}
.toggle span::after{content:"";position:absolute;width:24px;height:24px;left:2px;top:2px;background:#fff;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:.15s}
.toggle input:checked+span{background:#34c759}
.toggle input:checked+span::after{transform:translateX(18px)}
button{width:100%;border:0;border-radius:12px;padding:14px;font:600 15px inherit;font-family:inherit;cursor:pointer}
.allow{color:#fff}
.allow:disabled{opacity:.5;cursor:default}
.deny{background:none;color:#111827;margin-top:6px}
.foot{text-align:center;color:#9ca3af;font-size:12px;margin-top:14px}
`;

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
    `<h1>Something went wrong</h1><p class="muted">${escapeHtml(message)}</p>`,
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
  const rows = requested
    .map(
      (scope) => `<label class="scope">
  <div class="scope-body">
    <div class="scope-title">${escapeHtml(scope.description)}${scope.writes ? ' <span class="badge">Makes changes</span>' : ""}</div>
    <div class="scope-detail">${escapeHtml(scope.detail)}</div>
    <code>${escapeHtml(scope.id)}</code>
  </div>
  <span class="toggle"><input type="checkbox" name="scope" value="${escapeHtml(scope.id)}" checked><span></span></span>
</label>`,
    )
    .join("");
  return page(
    `${input.platformName} wants to access your ${input.brandName} account`,
    `<div class="brand"><span class="logo" style="background:${escapeHtml(input.color)}">${escapeHtml(input.brandName.charAt(0))}</span>${escapeHtml(input.brandName)}</div>
<div class="client">&#10022; ${escapeHtml(input.platformName)} <small>${escapeHtml(input.platformOrigin)}</small></div>
<h1>${escapeHtml(input.platformName)} wants to access your ${escapeHtml(input.brandName)} account</h1>
<p class="muted">Signed in as ${escapeHtml(input.email)}</p>
<form method="post" action="${escapeHtml(input.action)}" id="consent">
  <input type="hidden" name="session" value="${escapeHtml(input.session)}">
  <div class="scopes">${rows}</div>
  <button class="allow" style="background:${escapeHtml(input.color)}" type="submit" name="decision" value="allow" id="allow">Allow ${requested.length} of ${requested.length}</button>
  <button class="deny" type="submit" name="decision" value="deny">Don't allow</button>
</form>
<p class="foot">You can revoke access anytime in ${escapeHtml(input.brandName)} settings.<br>${escapeHtml(input.platformName)} never sees your password.</p>
<p class="foot">Powered by ${escapeHtml(input.providerName)}</p>
<script>
const boxes=[...document.querySelectorAll('input[name=scope]')];const allow=document.getElementById('allow');
function update(){const n=boxes.filter(b=>b.checked).length;allow.textContent='Allow '+n+' of '+boxes.length;allow.disabled=n===0;}
boxes.forEach(b=>b.addEventListener('change',update));
</script>`,
  );
}
