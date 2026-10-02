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

const staticAssets = new Map<string, { body: Buffer; contentType: string }>(
  await Promise.all(
    (
      [
        ["styles.css", new URL("../public/styles.css", import.meta.url), "text/css; charset=utf-8"],
        [
          "continue.js",
          new URL("../public/continue.js", import.meta.url),
          "text/javascript; charset=utf-8",
        ],
        ["icons/check.svg", new URL("../public/icons/check.svg", import.meta.url), "image/svg+xml"],
        ["icons/cross.svg", new URL("../public/icons/cross.svg", import.meta.url), "image/svg+xml"],
      ] as const
    ).map(
      async ([name, assetUrl, contentType]) =>
        [name, { body: await readFile(assetUrl), contentType }] as const,
    ),
  ),
);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BRAND_HEADER = `<div class="brand"><span class="logo">S</span>Skyline Airways</div>`;

function send(
  response: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, headers).end(body);
}

function html(
  response: ServerResponse,
  title: string,
  body: string,
  status = 200,
  includeContinueScript = false,
): void {
  send(
    response,
    status,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/static/styles.css"></head><body><main class="sheet">${body}</main>${includeContinueScript ? '<script src="/static/continue.js" defer></script>' : ""}</body></html>`,
    {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
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
    `${BRAND_HEADER}<form method="post" action="${escapeHtml(target.url)}"><input type="hidden" name="assertion" value="${escapeHtml(assertion)}"><p class="sub spaced">Signed in as <b>${escapeHtml(user.email)}</b>. Continuing…</p><noscript><button type="submit">Continue</button></noscript></form>`,
    200,
    true,
  );
}

function connectedPage(response: ServerResponse, url: URL): void {
  const client = url.searchParams.get("client") ?? "Your personal agent";
  if (url.searchParams.get("status") !== "approved") {
    return html(
      response,
      "Not connected",
      `${BRAND_HEADER}<div class="status no"><span class="glyph glyph-cross" aria-hidden="true"></span></div><h1>Not connected</h1><p class="sub"><b>${escapeHtml(client)}</b> can't access your Skyline account. You can close this tab.</p>`,
    );
  }
  const scopes = (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
  const labels = scopes.map((scope) => SCOPE_LABELS[scope] ?? scope);
  html(
    response,
    "Connected",
    `${BRAND_HEADER}<div class="status ok"><span class="glyph glyph-check" aria-hidden="true"></span></div><h1>You're connected</h1><p class="sub"><b>${escapeHtml(client)}</b> can now help with your Skyline account.</p>
<div class="label">Access you shared</div>
<ul class="granted">${labels.map((label) => `<li><span class="glyph glyph-check" aria-hidden="true"></span>${escapeHtml(label)}</li>`).join("")}</ul>
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
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname.startsWith("/static/")
    ) {
      const asset = staticAssets.get(url.pathname.slice("/static/".length));
      if (!asset) return send(response, 404, "Not found");
      response.writeHead(200, {
        "Content-Type": asset.contentType,
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      });
      return response.end(asset.body);
    }
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
