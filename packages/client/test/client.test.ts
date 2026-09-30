import { generateKeyPair, exportJWK, jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  A2AClient,
  A2AError,
  A2AHttpError,
  createPlatformSigner,
  PlatformRegistrationError,
  registerPlatform,
} from "../src/index.js";

describe("reference client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("signs a short ES256 token with required claims and header", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(privateKey);
    privateJwk.kid = "demo-key";
    const token = await createPlatformSigner({ privateJwk, issuer: "https://pa.example" }).sign({
      sub: "user-1",
      aud: "https://provider.example/a2a/acme",
      ttlSeconds: 90,
    });
    const verified = await jwtVerify(token, publicKey);
    expect(verified.protectedHeader).toMatchObject({ alg: "ES256", kid: "demo-key", typ: "JWT" });
    expect(verified.payload).toMatchObject({
      iss: "https://pa.example",
      sub: "user-1",
      aud: "https://provider.example/a2a/acme",
    });
    expect(verified.payload.jti).toBeTypeOf("string");
  });

  it("sends REST requests with fresh JWTs and the A2A version header", async () => {
    const signed: { sub: string; aud: string }[] = [];
    const signer = {
      issuer: "https://pa.example",
      sign: async (input: { sub: string; aud: string }) => {
        signed.push(input);
        return `token-${signed.length}`;
      },
    };
    const requests: { url: URL; init: RequestInit }[] = [];
    const task = { id: "task-1", status: { state: "TASK_STATE_COMPLETED" }, history: [] };
    const client = new A2AClient({
      url: "https://provider.example/a2a/acme/",
      signer,
      userId: "user-1",
      fetchImpl: async (input, init) => {
        requests.push({ url: new URL(input.toString()), init: init ?? {} });
        return Response.json({ task });
      },
    });

    const result = await client.sendMessage("hours", { contextId: "ctx-1" });
    expect(result.task.id).toBe("task-1");
    expect(await client.sendMessage("parking")).toMatchObject({ task: { id: "task-1" } });
    expect(signed).toEqual([
      { sub: "user-1", aud: "https://provider.example/a2a/acme" },
      { sub: "user-1", aud: "https://provider.example/a2a/acme" },
    ]);
    expect(requests.map(({ url }) => `${url.pathname}${url.search}`)).toEqual([
      "/a2a/acme/message:send",
      "/a2a/acme/message:send",
    ]);
    expect(requests[0]?.init.headers).toMatchObject({
      "A2A-Version": "1.0",
      Authorization: "Bearer token-1",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      message: {
        contextId: "ctx-1",
        role: "ROLE_USER",
        parts: [{ text: "hours", mediaType: "text/plain" }],
      },
    });
  });

  it("serializes task query parameters and cancel routes", async () => {
    const signer = { issuer: "https://pa.example", sign: async () => "token" };
    const requests: { url: URL; init: RequestInit }[] = [];
    const task = { id: "task-1", status: { state: "TASK_STATE_COMPLETED" }, history: [] };
    const client = new A2AClient({
      url: "https://provider.example/a2a/acme",
      signer,
      userId: "demo",
      fetchImpl: async (input, init) => {
        const url = new URL(input.toString());
        requests.push({ url, init: init ?? {} });
        if (url.pathname.endsWith("/tasks")) {
          return Response.json({ tasks: [task], nextPageToken: "", pageSize: 1, totalSize: 1 });
        }
        return Response.json(task);
      },
    });

    await client.getTask("task-1", 0);
    await client.listTasks({
      pageSize: 1,
      includeArtifacts: false,
      status: "TASK_STATE_COMPLETED",
    });
    await client.cancelTask("task-1");
    expect(requests.map(({ url }) => `${url.pathname}${url.search}`)).toEqual([
      "/a2a/acme/tasks/task-1?historyLength=0",
      "/a2a/acme/tasks?pageSize=1&includeArtifacts=false&status=TASK_STATE_COMPLETED",
      "/a2a/acme/tasks/task-1:cancel",
    ]);
    expect(requests[2]?.init.method).toBe("POST");
  });

  it("parses AIP-193 errors and keeps empty-body errors as HTTP errors", async () => {
    const signer = { issuer: "https://pa.example", sign: async () => "token" };
    const a2aClient = new A2AClient({
      url: "https://provider.example/a2a/acme",
      signer,
      userId: "demo",
      fetchImpl: async () =>
        Response.json(
          {
            error: {
              code: 404,
              status: "NOT_FOUND",
              message: "Task not found",
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
    await expect(a2aClient.getTask("missing")).rejects.toMatchObject({
      name: "A2AError",
      httpStatus: 404,
      status: "NOT_FOUND",
      reason: "TASK_NOT_FOUND",
      message: "Task not found",
    });

    const httpClient = new A2AClient({
      url: "https://provider.example/a2a/acme",
      signer,
      userId: "demo",
      fetchImpl: async () => new Response(null, { status: 401 }),
    });
    await expect(httpClient.getTask("missing")).rejects.toBeInstanceOf(A2AHttpError);
    await expect(httpClient.getTask("missing")).rejects.toMatchObject({ status: 401, body: "" });
  });

  it("exposes A2AError as a structured client error", async () => {
    const error = new A2AError(
      409,
      "FAILED_PRECONDITION",
      "TASK_NOT_CANCELABLE",
      "Task not cancelable",
      [],
    );
    expect(error).toMatchObject({
      httpStatus: 409,
      status: "FAILED_PRECONDITION",
      reason: "TASK_NOT_CANCELABLE",
      message: "Task not cancelable",
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
