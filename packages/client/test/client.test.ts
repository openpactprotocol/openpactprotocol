import { exportJWK, generateKeyPair, jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  A2AClient,
  A2AError,
  A2AHttpError,
  createPlatformSigner,
  PlatformRegistrationError,
  registerPlatform,
} from "../src/index.js";

const skylineCustomerId = "01M3R53Q5SZQ6FQSMSDBSSREAA";

describe("reference client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("signs short ES256 tokens with required claims and a generated jti", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(privateKey);
    privateJwk.kid = "demo-key";
    const token = await createPlatformSigner({
      privateJwk,
      issuer: "https://pa.example",
    }).sign({
      sub: "user-1",
      aud: "https://provider.example/a2a",
      ttlSeconds: 90,
    });
    const verified = await jwtVerify(token, publicKey);
    expect(verified.protectedHeader).toMatchObject({ alg: "ES256", kid: "demo-key", typ: "JWT" });
    expect(verified.payload).toMatchObject({
      iss: "https://pa.example",
      sub: "user-1",
      aud: "https://provider.example/a2a",
    });
    expect(verified.payload.jti).toBeTypeOf("string");
  });

  it("sends message-only REST requests with fresh JWTs and A2A headers", async () => {
    const signed: { sub: string; aud: string }[] = [];
    const signer = {
      issuer: "https://pa.example",
      sign: async (input: { sub: string; aud: string }) => {
        signed.push(input);
        return `token-${signed.length}`;
      },
    };
    const requests: { url: URL; init: RequestInit }[] = [];
    const message = {
      messageId: "agent-message",
      contextId: "00000000-0000-4000-8000-000000000000",
      role: "ROLE_AGENT",
      parts: [{ text: "I can check that. What's your confirmation code?" }],
    };
    const client = new A2AClient({
      url: `https://provider.example/a2a/${skylineCustomerId}/`,
      signer,
      userId: "user-1",
      fetchImpl: async (input, init) => {
        requests.push({ url: new URL(input.toString()), init: init ?? {} });
        return Response.json({ message });
      },
    });

    expect(
      await client.sendMessage("Is my Friday flight on time?", { contextId: message.contextId }),
    ).toEqual(message);
    expect(await client.sendMessage("ABC123")).toEqual(message);
    expect(signed).toEqual([
      { sub: "user-1", aud: "https://provider.example/a2a" },
      { sub: "user-1", aud: "https://provider.example/a2a" },
    ]);
    expect(requests.map(({ url }) => `${url.pathname}${url.search}`)).toEqual([
      `/a2a/${skylineCustomerId}/message:send`,
      `/a2a/${skylineCustomerId}/message:send`,
    ]);
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      headers: {
        "A2A-Version": "1.0",
        Authorization: "Bearer token-1",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      message: {
        contextId: message.contextId,
        role: "ROLE_USER",
        parts: [{ text: "Is my Friday flight on time?", mediaType: "text/plain" }],
      },
    });
    expect(JSON.parse(String(requests[0]?.init.body)).message).not.toHaveProperty("taskId");
  });

  it("allows an explicit A2A audience", async () => {
    const signed: { sub: string; aud: string }[] = [];
    const client = new A2AClient({
      url: "https://provider.example/a2a/customer-id",
      signer: {
        issuer: "https://pa.example",
        sign: async (input: { sub: string; aud: string }) => {
          signed.push(input);
          return "token";
        },
      },
      userId: "user-1",
      audience: "https://custom.example/audience",
      fetchImpl: async () =>
        Response.json({
          message: {
            messageId: "reply",
            contextId: "context",
            role: "ROLE_AGENT",
            parts: [{ text: "Hello" }],
          },
        }),
    });
    await client.sendMessage("hello");
    expect(signed).toEqual([{ sub: "user-1", aud: "https://custom.example/audience" }]);
  });

  it("discovers a card using a customer ID", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        name: "Skyline Airways",
        description: "Flight status and trip changes.",
        supportedInterfaces: [
          {
            url: `https://provider.example/a2a/${skylineCustomerId}`,
            protocolBinding: "HTTP+JSON",
            protocolVersion: "1.0",
          },
        ],
        version: "1.0",
        capabilities: {},
        defaultInputModes: ["text/plain"],
        defaultOutputModes: ["text/plain"],
        skills: [
          {
            id: "flight-status",
            name: "Flight status",
            description: "Check departure and arrival times for a booked flight.",
            tags: [
              "flight",
              "flights",
              "airline",
              "delay",
              "delayed",
              "departure",
              "boarding",
              "gate",
              "trip",
            ],
            examples: ["Is my Friday flight on time?"],
          },
        ],
      }),
    );
    const { discoverAgent } = await import("../src/index.js");
    const discovered = await discoverAgent("https://provider.example/", skylineCustomerId);
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://provider.example/a2a/${skylineCustomerId}/.well-known/agent-card.json`,
    );
    expect(discovered.url).toBe(`https://provider.example/a2a/${skylineCustomerId}`);
  });

  it("parses AIP-193 errors and preserves bare HTTP errors", async () => {
    const signer = { issuer: "https://pa.example", sign: async () => "token" };
    const a2aClient = new A2AClient({
      url: `https://provider.example/a2a/${skylineCustomerId}`,
      signer,
      userId: "demo",
      fetchImpl: async () =>
        Response.json(
          {
            error: {
              code: 404,
              status: "NOT_FOUND",
              message: "Task not found: missing",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason: "TASK_NOT_FOUND",
                  domain: "a2a-protocol.org",
                },
              ],
            },
          },
          { status: 404 },
        ),
    });
    await expect(a2aClient.sendMessage("hello")).rejects.toMatchObject({
      name: "A2AError",
      httpStatus: 404,
      status: "NOT_FOUND",
      reason: "TASK_NOT_FOUND",
      message: "Task not found: missing",
    });

    const httpClient = new A2AClient({
      url: `https://provider.example/a2a/${skylineCustomerId}`,
      signer,
      userId: "demo",
      fetchImpl: async () => new Response(null, { status: 401 }),
    });
    await expect(httpClient.sendMessage("hello")).rejects.toBeInstanceOf(A2AHttpError);
    await expect(httpClient.sendMessage("hello")).rejects.toMatchObject({ status: 401, body: "" });
  });

  it("exposes A2AError with structured details", () => {
    const error = new A2AError(
      400,
      "FAILED_PRECONDITION",
      "UNSUPPORTED_OPERATION",
      "Unsupported",
      [],
    );
    expect(error).toMatchObject({
      httpStatus: 400,
      status: "FAILED_PRECONDITION",
      reason: "UNSUPPORTED_OPERATION",
      message: "Unsupported",
      details: [],
    });
  });
});

describe("platform registration client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("self-signs registration assertions and maps 201/200 to created", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(privateKey);
    privateJwk.kid = "registration-key";
    const issuer = "https://pa.example";
    const providerUrl = "https://provider.example";
    const endpoint = `${providerUrl}/api/platforms`;
    const platform = {
      id: "00000000-0000-4000-8000-000000000000",
      name: "instinct",
      issuer,
      jwksUri: `${issuer}/.well-known/jwks.json`,
      enabled: true,
    };
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    let requestCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push({ input, ...(init === undefined ? {} : { init }) });
      const status = requestCount++ === 0 ? 201 : 200;
      return Response.json({ platform }, { status });
    });

    const signer = createPlatformSigner({ issuer, privateJwk });
    const first = await registerPlatform({ providerUrl, name: "instinct", signer });
    const second = await registerPlatform({ providerUrl, name: "instinct", signer });

    expect(first).toEqual({ created: true, platform });
    expect(second).toEqual({ created: false, platform });
    expect(calls.map(({ input }) => String(input))).toEqual([endpoint, endpoint]);
    const firstInit = calls[0]?.init;
    expect(JSON.parse(String(firstInit?.body))).toEqual({
      name: "instinct",
      jwksUri: `${issuer}/.well-known/jwks.json`,
    });
    const authorization = new Headers(firstInit?.headers).get("Authorization");
    const token = authorization?.replace(/^Bearer /, "");
    if (!token) throw new Error("Registration bearer token was not sent");
    const { payload } = await jwtVerify(token, publicKey, {
      issuer,
      audience: endpoint,
      algorithms: ["ES256"],
    });
    expect(payload).toMatchObject({ iss: issuer, sub: issuer, aud: endpoint });
  });

  it("throws PlatformRegistrationError with the provider conflict message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "Platform name is already registered" }, { status: 409 }),
    );
    const signer = {
      issuer: "https://pa.example",
      sign: async () => "signed-token",
    };
    const error = await registerPlatform({
      providerUrl: "https://provider.example",
      name: "instinct",
      signer,
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PlatformRegistrationError);
    expect(error).toMatchObject({
      status: 409,
      message: "Platform name is already registered",
    });
  });
});
