import { CompactSign, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { A2AHttpError, type AgentCard } from "../src/index.js";
import {
  DelegatedA2AClient,
  DelegationTokenRejectedError,
  DeviceCodeClient,
  OAuthError,
  ReceiptVerificationError,
  delegationScheme,
  verifyReceipt,
  type DelegationScheme,
  type ReceiptClaims,
} from "../src/delegation.js";

const brandUrl = "https://provider.example/a2a/01M3R53Q5WKZ7A0GY4PZ8Y39TB";
const paIssuer = "https://pa.example";

const card: AgentCard = {
  name: "Loom & Co.",
  description: "Orders",
  supportedInterfaces: [{ url: brandUrl, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" }],
  version: "0.1.0",
  capabilities: {},
  securitySchemes: {
    paJwt: { httpAuthSecurityScheme: { scheme: "Bearer", bearerFormat: "JWT" } },
    userDelegation: {
      oauth2SecurityScheme: {
        flows: {
          deviceCode: {
            deviceAuthorizationUrl: `${brandUrl}/oauth/device_authorization`,
            tokenUrl: `${brandUrl}/oauth/token`,
            scopes: {
              "orders:read": "See your orders",
              "delivery:change": "Redirect a delivery",
            },
          },
        },
        oauth2MetadataUrl: `${brandUrl}/oauth/.well-known/oauth-authorization-server`,
      },
    },
  },
  securityRequirements: [
    { schemes: { paJwt: { list: [] } } },
    { schemes: { paJwt: { list: [] }, userDelegation: { list: [] } } },
  ],
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [],
};

type Recorded = { url: string; headers: Headers; body: string };

function oauthError(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

function deviceClient(
  scheme: DelegationScheme,
  responses: Response[],
  extra: { now?: () => number; sleeps?: number[] } = {},
) {
  const requests: Recorded[] = [];
  const client = new DeviceCodeClient({
    scheme,
    clientId: paIssuer,
    getToken: () => "pa-jwt",
    fetchImpl: async (input, init) => {
      requests.push({
        url: input.toString(),
        headers: new Headers(init?.headers),
        body: String(init?.body),
      });
      const next = responses.shift();
      if (!next) throw new Error("Unexpected request");
      return next;
    },
    sleep: async (ms) => {
      extra.sleeps?.push(ms);
    },
    ...(extra.now ? { now: extra.now } : {}),
  });
  return { client, requests };
}

const tokenResponse = {
  token_type: "Bearer",
  access_token: "delegation-jwt",
  refresh_token: "rt_1",
  expires_in: 3600,
  scope: "orders:read",
};

describe("@openpactprotocol/client/delegation", () => {
  let scheme: DelegationScheme;
  let privateKey: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    scheme = delegationScheme(card)!;
    const pair = await generateKeyPair("ES256", { extractable: true });
    privateKey = pair.privateKey;
    jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "p-1" }] });
  });

  it("reads the device-code scheme from a card and ignores Identity-only cards", () => {
    expect(scheme).toEqual({
      identitySchemeName: "paJwt",
      delegationSchemeName: "userDelegation",
      deviceAuthorizationUrl: `${brandUrl}/oauth/device_authorization`,
      tokenUrl: `${brandUrl}/oauth/token`,
      refreshUrl: `${brandUrl}/oauth/token`,
      metadataUrl: `${brandUrl}/oauth/.well-known/oauth-authorization-server`,
      scopes: [
        { id: "orders:read", description: "See your orders" },
        { id: "delivery:change", description: "Redirect a delivery" },
      ],
    });
    expect(
      delegationScheme({ ...card, securityRequirements: [{ schemes: { paJwt: { list: [] } } }] }),
    ).toBeUndefined();
  });

  it("starts device authorization with the PA JWT and only card scopes", async () => {
    const { client, requests } = deviceClient(
      scheme,
      [
        Response.json({
          device_code: "dc_1",
          user_code: "WDJB-MJHT",
          verification_uri: "https://brand.example/login",
          verification_uri_complete: "https://brand.example/login?user_code=WDJB-MJHT",
          expires_in: 600,
        }),
      ],
      { now: () => 1_000 },
    );
    await expect(client.start(["refunds:issue"])).rejects.toThrow("not on the Agent Card");
    await expect(client.start([])).rejects.toThrow("at least one scope");
    expect(await client.start(["orders:read", "delivery:change"])).toEqual({
      deviceCode: "dc_1",
      userCode: "WDJB-MJHT",
      verificationUri: "https://brand.example/login",
      verificationUriComplete: "https://brand.example/login?user_code=WDJB-MJHT",
      expiresAt: 601_000,
      intervalSeconds: 5,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(scheme.deviceAuthorizationUrl);
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer pa-jwt");
    expect(Object.fromEntries(new URLSearchParams(requests[0]!.body))).toEqual({
      scope: "orders:read delivery:change",
      client_id: paIssuer,
    });
  });

  it("surfaces OAuth errors and treats 401 as a PA JWT failure", async () => {
    const { client } = deviceClient(scheme, [
      oauthError("invalid_scope"),
      new Response(null, { status: 401 }),
    ]);
    await expect(client.start(["orders:read"])).rejects.toMatchObject({
      name: "OAuthError",
      error: "invalid_scope",
    });
    await expect(client.start(["orders:read"])).rejects.toBeInstanceOf(A2AHttpError);
  });

  it("polls through pending and slow_down until granted", async () => {
    const sleeps: number[] = [];
    const { client, requests } = deviceClient(
      scheme,
      [oauthError("authorization_pending"), oauthError("slow_down"), Response.json(tokenResponse)],
      { now: () => 0, sleeps },
    );
    const token = await client.waitForToken({
      deviceCode: "dc_1",
      userCode: "U",
      verificationUri: "https://brand.example/login",
      verificationUriComplete: "https://brand.example/login",
      expiresAt: 600_000,
      intervalSeconds: 5,
    });
    expect(sleeps).toEqual([5_000, 5_000, 10_000]);
    expect(token).toEqual({
      accessToken: "delegation-jwt",
      refreshToken: "rt_1",
      scopes: ["orders:read"],
      expiresAt: 3_600_000,
    });
    expect(Object.fromEntries(new URLSearchParams(requests[0]!.body))).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "dc_1",
      client_id: paIssuer,
    });
  });

  it("stops on access_denied and on expiry", async () => {
    const authorization = {
      deviceCode: "dc_1",
      userCode: "U",
      verificationUri: "https://brand.example/login",
      verificationUriComplete: "https://brand.example/login",
      expiresAt: 10_000,
      intervalSeconds: 5,
    };
    const denied = deviceClient(scheme, [oauthError("access_denied")], { now: () => 0 });
    await expect(denied.client.waitForToken(authorization)).rejects.toMatchObject({
      error: "access_denied",
    });

    let clock = 0;
    const expiring = deviceClient(
      scheme,
      [oauthError("authorization_pending"), oauthError("authorization_pending")],
      { now: () => (clock += 5_000) - 5_000 },
    );
    const error = await expiring.client.waitForToken(authorization).catch((caught) => caught);
    expect(error).toBeInstanceOf(OAuthError);
    expect(error).toMatchObject({ error: "expired_token" });
  });

  it("refreshes with the refresh_token grant", async () => {
    const { client, requests } = deviceClient(
      scheme,
      [Response.json({ ...tokenResponse, refresh_token: "rt_2" })],
      { now: () => 0 },
    );
    expect((await client.refresh("rt_1")).refreshToken).toBe("rt_2");
    expect(Object.fromEntries(new URLSearchParams(requests[0]!.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "rt_1",
      client_id: paIssuer,
    });
  });

  async function signedReceipt(claims: ReceiptClaims) {
    const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
      .setProtectedHeader({ alg: "ES256", kid: "p-1" })
      .sign(privateKey);
    return { jws, claims };
  }

  const claims: ReceiptClaims = {
    grantId: "a2agrant_1",
    user: "jane-4471",
    pa: paIssuer,
    brand: brandUrl,
    scopesUsed: ["orders:read"],
    actions: [{ tool: "lookup_orders" }],
    ts: "2026-10-02T12:00:00Z",
  };

  it("sends both tokens and returns the reply with its receipt", async () => {
    const receipt = await signedReceipt(claims);
    let headers = new Headers();
    const client = new DelegatedA2AClient({
      url: `${brandUrl}/`,
      getToken: () => "pa-jwt",
      getDelegationToken: () => "delegation-jwt",
      fetchImpl: async (input, init) => {
        expect(input.toString()).toBe(`${brandUrl}/message:send`);
        headers = new Headers(init?.headers);
        return Response.json({
          message: {
            messageId: "r-1",
            contextId: "c-1",
            role: "ROLE_AGENT",
            parts: [{ text: "Order LC-1042 is out for delivery." }],
            metadata: { "pact.receipt": receipt },
          },
        });
      },
    });
    const result = await client.send("Where is my order?", { contextId: "c-1" });
    expect(headers.get("authorization")).toBe("Bearer pa-jwt");
    expect(headers.get("x-a2a-user-delegation")).toBe("Bearer delegation-jwt");
    expect(result).toMatchObject({ kind: "message", receipt });
    if (result.kind !== "message" || !result.receipt) throw new Error("expected a receipt");
    expect(await verifyReceipt(result.receipt, { jwks, expected: { pa: paIssuer } })).toEqual(
      claims,
    );
  });

  it("omits the delegation header without a token and returns step-up tasks", async () => {
    let headers = new Headers();
    const client = new DelegatedA2AClient({
      url: brandUrl,
      getToken: () => "pa-jwt",
      fetchImpl: async (_input, init) => {
        headers = new Headers(init?.headers);
        return Response.json({
          task: {
            id: "t-1",
            contextId: "c-1",
            status: { state: "TASK_STATE_AUTH_REQUIRED" },
            metadata: { "pact.missingScopes": ["delivery:change"] },
          },
        });
      },
    });
    expect(await client.send("Redirect it")).toMatchObject({
      kind: "authRequired",
      missingScopes: ["delivery:change"],
    });
    expect(headers.has("x-a2a-user-delegation")).toBe(false);
  });

  it("distinguishes a rejected delegation token from other 401s", async () => {
    const client = (header: string) =>
      new DelegatedA2AClient({
        url: brandUrl,
        getToken: () => "pa-jwt",
        getDelegationToken: () => "delegation-jwt",
        fetchImpl: async () =>
          new Response(null, { status: 401, headers: { "WWW-Authenticate": header } }),
      });
    await expect(
      client('Bearer realm="a2a", error="invalid_token"').send("hi"),
    ).rejects.toBeInstanceOf(DelegationTokenRejectedError);
    const plain = await client('Bearer realm="a2a"')
      .send("hi")
      .catch((error) => error);
    expect(plain).toBeInstanceOf(A2AHttpError);
    expect(plain).not.toBeInstanceOf(DelegationTokenRejectedError);
  });

  it("rejects receipts whose claims, signer or expectations don't match", async () => {
    const receipt = await signedReceipt(claims);
    await expect(
      verifyReceipt(
        { ...receipt, claims: { ...claims, scopesUsed: ["delivery:change"] } },
        { jwks },
      ),
    ).rejects.toBeInstanceOf(ReceiptVerificationError);
    await expect(
      verifyReceipt(receipt, { jwks, expected: { brand: "https://other.example/a2a/x" } }),
    ).rejects.toThrow("brand");
    const other = await generateKeyPair("ES256", { extractable: true });
    const otherJwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(other.publicKey)), kid: "p-1" }],
    });
    await expect(verifyReceipt(receipt, { jwks: otherJwks })).rejects.toThrow("signature");
  });
});
