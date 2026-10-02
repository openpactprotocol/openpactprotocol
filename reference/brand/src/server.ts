import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { findUser, pastTrips, rebook, SCOPE_LABELS, upcomingTrips } from "./data.js";

// Example Brand (Skyline Airways). It owns login, accounts and the account
// API. The Provider owns OAuth: after login the Brand POSTs a signed, single-use
// assertion to the Provider's consent page (spec §5.3).

const PORT = Number(process.env.PORT ?? 3004);
const BRAND_URL = (process.env.BRAND_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");
const PROVIDER_URL = (process.env.PROVIDER_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const CUSTOMER_ID = process.env.BRAND_CUSTOMER_ID ?? "01M3R53Q5SZQ6FQSMSDBSSREAA";
const INTERFACE_URL = `${PROVIDER_URL}/a2a/${CUSTOMER_ID}`;
const ISSUER = `${INTERFACE_URL}/oauth`;
const CONSENT_URL = `${ISSUER}/consent`;
const providerJwks = createRemoteJWKSet(new URL(`${ISSUER}/jwks.json`), {
  timeoutDuration: 15_000,
});

type BrandKey = { privateKey: CryptoKey; kid: string; publicJwk: JWK };

async function loadKey(): Promise<BrandKey> {
  let jwk: JWK;
  if (process.env.BRAND_PRIVATE_JWK) {
    jwk = JSON.parse(process.env.BRAND_PRIVATE_JWK) as JWK;
  } else {
    const path = resolve(process.cwd(), ".data/brand-signing-key.json");
    try {
      jwk = JSON.parse(await readFile(path, "utf8")) as JWK;
    } catch {
      const { privateKey } = await generateKeyPair("ES256", { extractable: true });
      jwk = await exportJWK(privateKey);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(jwk), { mode: 0o600 });
    }
  }
  const publicJwk: JWK = { kty: jwk.kty!, crv: jwk.crv!, x: jwk.x!, y: jwk.y! };
  const kid = await calculateJwkThumbprint(publicJwk, "sha256");
  return {
    privateKey: (await importJWK(jwk, "ES256")) as CryptoKey,
    kid,
    publicJwk: { ...publicJwk, kid, alg: "ES256", use: "sig" },
  };
}

const key = await loadKey();

function escapeHtml(value: string): string {
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
.logo{width:32px;height:32px;border-radius:9px;background:#16345c;color:#fff;display:grid;place-items:center;font-weight:700;flex:none}
h1{font-size:20px;line-height:1.3;margin:26px 0 6px;text-align:center;font-weight:650}
.sub{color:#6b7280;font-size:13px;margin:0;text-align:center}
.sub b{color:#374151;font-weight:600}
label{display:block;font-size:13px;font-weight:600;color:#374151;margin:16px 0 6px}
input{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font:inherit}
input:focus{outline:2px solid #16345c;outline-offset:-1px;border-color:#16345c}
button{width:100%;border:0;border-radius:12px;padding:13px;margin-top:22px;background:#16345c;color:#fff;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer}
.hint{margin:16px 0 0;padding:10px 12px;border-radius:10px;background:#f3f4f6;color:#6b7280;font-size:12px;text-align:center}
.hint code{color:#374151}
.error{background:#fef2f2;color:#991b1b;border-radius:10px;padding:10px 12px;font-size:13px;margin-top:18px}
.status{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;margin:26px auto 0}
.status svg{width:28px;height:28px}
.status.ok{background:#dcfce7;color:#16a34a}
.status.no{background:#f3f4f6;color:#6b7280}
.status+h1{margin-top:14px}
.label{font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin:24px 0 8px}
.granted{margin:0;padding:0;list-style:none;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden}
.granted li{display:flex;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid #f0f1f3;font-size:14px;font-weight:500}
.granted li:first-child{border-top:0}
.granted svg{width:18px;height:18px;color:#16a34a;flex:none}
.foot{text-align:center;color:#9ca3af;font-size:12px;margin:18px 0 0}
`;

const BRAND_HEADER = `<div class="brand"><span class="logo">S</span>Skyline Airways</div>`;
const SVG = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const CHECK = SVG('<path d="M20 6 9 17l-5-5"/>');
const CROSS = SVG('<path d="M18 6 6 18M6 6l12 12"/>');

function send(
  response: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, headers).end(body);
}

function html(response: ServerResponse, title: string, body: string, status = 200): void {
  send(
    response,
    status,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLES}</style></head><body><main class="sheet">${body}</main></body></html>`,
    {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    },
  );
}

function json(response: ServerResponse, status: number, body: unknown): void {
  send(response, status, JSON.stringify(body), { "Content-Type": "application/json" });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// Only hand assertions to this Brand's consent page at its Provider.
function consentTarget(returnTo: string | null): { url: string; userCode: string | null } | null {
  if (!returnTo) return null;
  try {
    const url = new URL(returnTo);
    if (`${url.origin}${url.pathname}` !== CONSENT_URL) return null;
    return { url: CONSENT_URL, userCode: url.searchParams.get("user_code") };
  } catch {
    return null;
  }
}

function loginPage(
  response: ServerResponse,
  input: { returnTo: string; userCode: string | null; email?: string; error?: string },
): void {
  html(
    response,
    "Sign in to Skyline Airways",
    `${BRAND_HEADER}<h1>Sign in to Skyline Airways</h1><p class="sub">to connect your personal agent</p>
<form method="post" action="/login">
  ${input.error ? `<div class="error">${escapeHtml(input.error)}</div>` : ""}
  <input type="hidden" name="return_to" value="${escapeHtml(input.returnTo)}">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username" value="${escapeHtml(input.email ?? "alex.rivera@example.com")}" required>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  ${
    input.userCode
      ? `<input type="hidden" name="user_code" value="${escapeHtml(input.userCode)}">`
      : `<label for="user_code">Code from your agent</label><input id="user_code" name="user_code" placeholder="ABCD-EFGH" required>`
  }
  <button type="submit">Sign in</button>
</form>
<p class="hint">Demo account: <code>alex.rivera@example.com</code> / <code>skyline</code></p>`,
  );
}

async function handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const form = new URLSearchParams(await readBody(request));
  const returnTo = form.get("return_to") ?? "";
  const target = consentTarget(returnTo);
  if (!target)
    return html(
      response,
      "Skyline",
      `${BRAND_HEADER}<h1>Unknown sign-in request</h1><p class="sub">Start again from your agent.</p>`,
      400,
    );
  const userCode = (form.get("user_code") ?? target.userCode ?? "").trim().toUpperCase();
  const user = findUser(form.get("email") ?? "", form.get("password") ?? "");
  if (!user || !userCode) {
    return loginPage(response, {
      returnTo,
      userCode: target.userCode,
      email: form.get("email") ?? "",
      error: "That email and password don't match a Skyline account.",
    });
  }
  const assertion = await new SignJWT({ user_code: userCode, email: user.email, name: user.name })
    .setProtectedHeader({ alg: "ES256", kid: key.kid, typ: "JWT" })
    .setIssuer(BRAND_URL)
    .setAudience(target.url)
    .setSubject(user.id)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(key.privateKey);
  html(
    response,
    "Signing in…",
    `${BRAND_HEADER}<form method="post" action="${escapeHtml(target.url)}"><input type="hidden" name="assertion" value="${escapeHtml(assertion)}"><p class="sub" style="margin-top:26px">Signed in as <b>${escapeHtml(user.email)}</b>. Continuing…</p><noscript><button type="submit">Continue</button></noscript></form><script>document.forms[0].submit()</script>`,
  );
}

function connectedPage(response: ServerResponse, url: URL): void {
  const client = url.searchParams.get("client") ?? "Your personal agent";
  if (url.searchParams.get("status") !== "approved") {
    return html(
      response,
      "Not connected",
      `${BRAND_HEADER}<div class="status no">${CROSS}</div><h1>Not connected</h1><p class="sub"><b>${escapeHtml(client)}</b> can't access your Skyline account. You can close this tab.</p>`,
    );
  }
  const scopes = (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
  const labels = scopes.map((scope) => SCOPE_LABELS[scope] ?? scope);
  html(
    response,
    "Connected",
    `${BRAND_HEADER}<div class="status ok">${CHECK}</div><h1>You're connected</h1><p class="sub"><b>${escapeHtml(client)}</b> can now help with your Skyline account.</p>
<div class="label">Access you shared</div>
<ul class="granted">${labels.map((label) => `<li>${CHECK}${escapeHtml(label)}</li>`).join("")}</ul>
<p class="foot">You can close this tab and go back to your agent. Manage or revoke access anytime in Skyline settings.</p>`,
  );
}

// Account API. Accepts only Provider-signed delegation tokens for this Brand.
async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const token = request.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  let sub: string;
  let scopes: Set<string>;
  try {
    const { payload } = await jwtVerify(token ?? "", providerJwks, {
      issuer: ISSUER,
      audience: INTERFACE_URL,
      typ: "at+jwt",
      algorithms: ["ES256", "RS256"],
    });
    sub = String(payload.sub);
    scopes = new Set(String(payload.scope ?? "").split(" "));
  } catch (error) {
    console.warn("Rejected API token:", error instanceof Error ? error.message : error);
    return json(response, 401, { error: "invalid_token" });
  }
  const need = (scope: string) => {
    if (scopes.has(scope)) return true;
    json(response, 403, { error: "insufficient_scope", scope });
    return false;
  };
  if (request.method === "GET" && url.pathname === "/api/trips/upcoming") {
    if (need("flights:upcoming:read")) json(response, 200, { trips: upcomingTrips(sub) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/trips/past") {
    if (need("flights:history:read")) json(response, 200, { trips: pastTrips(sub) });
    return;
  }
  const rebookPath = url.pathname.match(/^\/api\/trips\/([^/]+)\/rebook$/);
  if (request.method === "POST" && rebookPath) {
    if (!need("flights:rebook")) return;
    const body = JSON.parse((await readBody(request)) || "{}") as { flight?: unknown };
    const trip = rebook(sub, decodeURIComponent(rebookPath[1]!), String(body.flight ?? ""));
    if (!trip) return json(response, 404, { error: "not_found" });
    console.log(`Rebooked ${trip.confirmation} onto ${trip.flight} for ${sub}`);
    return json(response, 200, { trip });
  }
  json(response, 404, { error: "not_found" });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", BRAND_URL);
  try {
    if (request.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      return send(response, 200, JSON.stringify({ keys: [key.publicJwk] }), {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      });
    }
    if (request.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
      return send(response, 302, "", {
        Location: `${INTERFACE_URL}/.well-known/agent-card.json`,
      });
    }
    if (request.method === "GET" && url.pathname === "/login") {
      const returnTo = url.searchParams.get("return_to");
      const target = consentTarget(returnTo);
      if (!target || !returnTo) {
        return html(
          response,
          "Skyline",
          `${BRAND_HEADER}<h1>Unknown sign-in request</h1><p class="sub">Start again from your agent.</p>`,
          400,
        );
      }
      return loginPage(response, { returnTo, userCode: target.userCode });
    }
    if (request.method === "POST" && url.pathname === "/login") {
      return await handleLogin(request, response);
    }
    if (request.method === "GET" && url.pathname === "/connected") {
      return connectedPage(response, url);
    }
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    if (request.method === "GET" && url.pathname === "/") {
      return html(
        response,
        "Skyline Airways",
        `${BRAND_HEADER}<h1>Example Brand</h1><p class="sub">Login, accounts and the account API for the PACT Delegated demo.</p><p class="foot">Agent Card: <a href="/.well-known/agent-card.json">/.well-known/agent-card.json</a></p>`,
      );
    }
    send(response, 404, "Not found");
  } catch (error) {
    console.error("Brand request failed", error);
    if (!response.headersSent) send(response, 500, "Internal error");
  }
});

server.listen(PORT, () => {
  console.log(`Skyline Brand listening on ${BRAND_URL} (Provider ${PROVIDER_URL})`);
});
