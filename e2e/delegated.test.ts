import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  A2AHttpError,
  createPlatformSigner,
  fetchAgentCard,
  interfaceUrl,
} from "@openpactprotocol/client";
import {
  DelegatedA2AClient,
  DelegationTokenRejectedError,
  DeviceCodeClient,
  OAuthError,
  delegationScheme,
  fetchAuthorizationServerMetadata,
  verifyReceipt,
  type DelegationScheme,
  type DelegationToken,
} from "@openpactprotocol/client/delegation";

// PACT Delegated (spec §5) against the reference stack with DELEGATION_ENABLED=1
// and the example Skyline Brand app (reference/brand). Skips when the card
// doesn't advertise delegation.

function readLocalEnv(): void {
  const path = fileURLToPath(
    new URL("../reference/personal-agent/client/.env.local", import.meta.url),
  );
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] && !process.env[match[1]]) {
      process.env[match[1]] = (match[2] ?? "").replace(/^['"]|['"]$/g, "");
    }
  }
}

readLocalEnv();

const providerUrl = (process.env.PROVIDER_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const customerId = process.env.DELEGATED_CUSTOMER_ID ?? "01M3R53Q5SZQ6FQSMSDBSSREAA";
const issuer = process.env.PA_ISSUER ?? "";
const audience = process.env.PA_AUDIENCE ?? "";
const privateJwk = process.env.PA_PRIVATE_JWK ?? "";
const brandEmail = process.env.BRAND_LOGIN_EMAIL ?? "alex.rivera@example.com";
const brandPassword = process.env.BRAND_LOGIN_PASSWORD ?? "skyline";

const card = await fetchAgentCard(`${providerUrl}/a2a/${customerId}/.well-known/agent-card.json`)
  .then((agentCard) => ({ card: agentCard, url: interfaceUrl(agentCard) }))
  .catch(() => undefined);
const scheme: DelegationScheme | undefined = card ? delegationScheme(card.card) : undefined;

function field(html: string, name: string): string {
  const value = html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
  if (!value) throw new Error(`No ${name} field in page`);
  return value;
}

// Plays the User: Brand login (reference/brand), then the Provider consent page.
async function approveInBrowser(
  verificationUriComplete: string,
  scopes: string[],
  decision: "allow" | "deny" = "allow",
): Promise<string> {
  const loginUrl = new URL(verificationUriComplete);
  const returnTo = loginUrl.searchParams.get("return_to") ?? "";
  const login = await fetch(new URL("/login", loginUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ return_to: returnTo, email: brandEmail, password: brandPassword }),
  });
  const loginHtml = await login.text();
  const consentAction = loginHtml.match(/<form[^>]*action="([^"]+)"/)?.[1] ?? "";
  const consent = await fetch(consentAction, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ assertion: field(loginHtml, "assertion") }),
  });
  const consentHtml = await consent.text();
  expect(consent.status).toBe(200);
  const decisionAction = consentHtml.match(/<form method="post" action="([^"]+)"/)?.[1] ?? "";
  const body = new URLSearchParams({ session: field(consentHtml, "session"), decision });
  for (const scope of scopes) body.append("scope", scope);
  const result = await fetch(decisionAction.replace(/&amp;/g, "&"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  return result.headers.get("location") ?? (await result.text());
}

describe.skipIf(!scheme)("PACT Delegated", () => {
  const signer = createPlatformSigner({ issuer, privateJwk });
  const sub = `e2e-delegated-${crypto.randomUUID()}`;
  const getToken = () => signer.sign({ sub, aud: audience });
  let oauth: DeviceCodeClient;
  let token: DelegationToken;
  let contextId: string | undefined;

  beforeAll(() => {
    oauth = new DeviceCodeClient({ scheme: scheme!, clientId: issuer, getToken });
  });

  it("advertises the Skyline scopes and RFC 8414 metadata", async () => {
    expect(scheme!.scopes.map((scope) => scope.id)).toEqual([
      "flights:upcoming:read",
      "flights:history:read",
      "flights:rebook",
    ]);
    const metadata = await fetchAuthorizationServerMetadata(scheme!.metadataUrl);
    expect(metadata.token_endpoint).toBe(scheme!.tokenUrl);
    expect(metadata.device_authorization_endpoint).toBe(scheme!.deviceAuthorizationUrl);
  });

  it("returns AUTH_REQUIRED with the missing scope when no token is sent", async () => {
    const result = await new DelegatedA2AClient({ url: card!.url, getToken }).send(
      "Can you check my upcoming flights?",
    );
    expect(result.kind).toBe("authRequired");
    if (result.kind !== "authRequired") return;
    expect(result.missingScopes).toEqual(["flights:upcoming:read"]);
    expect(result.verificationUriComplete).toMatch(/\/login\?return_to=/);
    contextId = result.task.contextId;
  });

  it("rejects a client_id that isn't the PA issuer", async () => {
    const wrong = new DeviceCodeClient({
      scheme: scheme!,
      clientId: "https://other.example",
      getToken,
    });
    await expect(wrong.start(["flights:upcoming:read"])).rejects.toBeInstanceOf(A2AHttpError);
  });

  it("issues a token for only the scopes the User allowed", async () => {
    const authorization = await oauth.start(scheme!.scopes.map((scope) => scope.id));
    expect((await oauth.poll(authorization.deviceCode)).status).toBe("pending");
    const redirect = await approveInBrowser(authorization.verificationUriComplete, [
      "flights:upcoming:read",
      "flights:history:read",
    ]);
    expect(redirect).toMatch(/\/connected\?.*status=approved/);
    token = await oauth.waitForToken(authorization);
    expect(token.scopes.sort()).toEqual(["flights:history:read", "flights:upcoming:read"]);
    await expect(oauth.poll(authorization.deviceCode)).rejects.toBeInstanceOf(OAuthError);
  });

  it("answers with the User's booking and a signed receipt", async () => {
    const result = await new DelegatedA2AClient({
      url: card!.url,
      getToken,
      getDelegationToken: () => token.accessToken,
    }).send("Can you check my upcoming flights?", contextId ? { contextId } : {});
    expect(result.kind).toBe("message");
    if (result.kind !== "message") return;
    expect(JSON.stringify(result.message.parts)).toContain("SK 482");
    expect(result.receipt).toBeDefined();
    const metadata = await fetchAuthorizationServerMetadata(scheme!.metadataUrl);
    const claims = await verifyReceipt(result.receipt!, {
      jwks: metadata.jwks_uri,
      expected: { pa: issuer, brand: card!.url },
    });
    expect(claims.scopesUsed).toEqual(["flights:upcoming:read"]);
    contextId = result.message.contextId;
  });

  it("steps up when an action needs a scope that wasn't granted", async () => {
    const result = await new DelegatedA2AClient({
      url: card!.url,
      getToken,
      getDelegationToken: () => token.accessToken,
    }).send("Please rebook me onto SK 318", contextId ? { contextId } : {});
    expect(result.kind).toBe("authRequired");
    if (result.kind !== "authRequired") return;
    expect(result.missingScopes).toEqual(["flights:rebook"]);
  });

  it("rotates refresh tokens and rejects reuse", async () => {
    const refreshed = await oauth.refresh(token.refreshToken!);
    expect(refreshed.scopes.sort()).toEqual(token.scopes.sort());
    await expect(oauth.refresh(token.refreshToken!)).rejects.toBeInstanceOf(OAuthError);
  });

  it("rejects a denied consent", async () => {
    const authorization = await oauth.start(["flights:history:read"]);
    const redirect = await approveInBrowser(
      authorization.verificationUriComplete,
      ["flights:history:read"],
      "deny",
    );
    expect(redirect).toMatch(/status=denied/);
    await expect(oauth.poll(authorization.deviceCode)).rejects.toMatchObject({
      error: "access_denied",
    });
  });

  it("rejects a delegation token presented by another personal agent's user", async () => {
    const other = createPlatformSigner({ issuer, privateJwk });
    const client = new DelegatedA2AClient({
      url: card!.url,
      getToken: () => other.sign({ sub, aud: audience }),
      getDelegationToken: () => `${token.accessToken.slice(0, -4)}AAAA`,
    });
    await expect(client.send("my upcoming flights")).rejects.toBeInstanceOf(
      DelegationTokenRejectedError,
    );
  });
});
