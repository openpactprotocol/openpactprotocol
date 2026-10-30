import { createHmac } from "node:crypto";
import { exportJWK, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
  A2AClient,
  A2AError,
  A2AHttpError,
  createPlatformSigner,
  fetchAgentCard,
  interfaceUrl,
  verifyContextCallback,
} from "../src/index.js";

const skylineCustomerId = "01M3R53Q5SZQ6FQSMSDBSSREAA";
const skylineInterfaceUrl = `https://provider.example/a2a/${skylineCustomerId}`;
const skylineCard = {
  name: "Skyline Airways",
  description: "Flight status and trip changes.",
  supportedInterfaces: [
    { url: skylineInterfaceUrl, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" },
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
      tags: ["flight", "delay"],
      examples: ["Is my Friday flight on time?"],
    },
  ],
};

describe("@openpactprotocol/client", () => {
  it("signs ES256 PA JWTs with the PACT claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = { ...(await exportJWK(privateKey)), kid: "key-1" };
    const signer = createPlatformSigner({ issuer: "https://pa.example", privateJwk });
    const token = await signer.sign({ sub: "user-7f3a", aud: "aud-1" });
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      issuer: "https://pa.example",
      audience: "aud-1",
    });
    expect(protectedHeader).toMatchObject({ alg: "ES256", kid: "key-1", typ: "JWT" });
    expect(payload.sub).toBe("user-7f3a");
    expect(payload.exp! - payload.iat!).toBe(120);
    expect(payload.jti).toEqual(expect.any(String));
    await expect(signer.sign({ sub: "u", aud: "a", ttlSeconds: 301 })).rejects.toThrow(
      "ttlSeconds",
    );
    expect(() => createPlatformSigner({ issuer: "x", privateJwk: { kty: "EC" } })).toThrow("kid");
  });

  it("fetches and validates an Agent Card and selects the HTTP+JSON 1.0 interface", async () => {
    const fetched: string[] = [];
    const card = await fetchAgentCard(
      `${skylineInterfaceUrl}/.well-known/agent-card.json`,
      async (input) => {
        fetched.push(input.toString());
        return Response.json(skylineCard);
      },
    );
    expect(fetched).toEqual([`${skylineInterfaceUrl}/.well-known/agent-card.json`]);
    expect(card.name).toBe("Skyline Airways");
    expect(interfaceUrl(card)).toBe(skylineInterfaceUrl);
    expect(() =>
      interfaceUrl({
        ...card,
        supportedInterfaces: [{ ...card.supportedInterfaces[0]!, protocolBinding: "GRPC" }],
      }),
    ).toThrow("HTTP+JSON 1.0");
  });

  it("turns a non-2xx card response into A2AHttpError", async () => {
    await expect(
      fetchAgentCard(
        "https://provider.example/missing",
        async () => new Response("", { status: 404 }),
      ),
    ).rejects.toMatchObject({ name: "A2AHttpError", status: 404 });
  });

  it("sends message:send with a fresh token and A2A headers", async () => {
    let tokens = 0;
    const requests: { url: URL; init: RequestInit }[] = [];
    const message = {
      messageId: "agent-message",
      contextId: "00000000-0000-4000-8000-000000000000",
      role: "ROLE_AGENT",
      parts: [{ text: "I can check that. What's your confirmation code?" }],
    };
    const client = new A2AClient({
      url: `${skylineInterfaceUrl}/`,
      getToken: () => `token-${++tokens}`,
      fetchImpl: async (input, init) => {
        requests.push({ url: new URL(input.toString()), init: init ?? {} });
        return Response.json({ message });
      },
    });

    expect(
      await client.sendMessage("Is my Friday flight on time?", { contextId: message.contextId }),
    ).toEqual(message);
    expect(await client.sendMessage("ABC123")).toEqual(message);
    expect(requests.map(({ url }) => url.pathname)).toEqual([
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
    expect(new Headers(requests[1]?.init.headers).get("Authorization")).toBe("Bearer token-2");
    const body = JSON.parse(String(requests[0]?.init.body));
    expect(body).toMatchObject({
      message: {
        contextId: message.contextId,
        role: "ROLE_USER",
        parts: [{ text: "Is my Friday flight on time?", mediaType: "text/plain" }],
      },
    });
    expect(body.message).not.toHaveProperty("taskId");
    expect(JSON.parse(String(requests[1]?.init.body)).message).not.toHaveProperty("contextId");
  });

  it("parses AIP-193 errors and preserves bare HTTP errors", async () => {
    const a2aClient = new A2AClient({
      url: skylineInterfaceUrl,
      getToken: () => "token",
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
      url: skylineInterfaceUrl,
      getToken: () => "token",
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

  it("lists contexts and their messages with page options", async () => {
    const requests: { url: URL; init: RequestInit }[] = [];
    const contextId = "00000000-0000-4000-8000-000000000000";
    const client = new A2AClient({
      url: skylineInterfaceUrl,
      getToken: () => "token",
      fetchImpl: async (input, init) => {
        const url = new URL(input.toString());
        requests.push({ url, init: init ?? {} });
        return url.pathname.endsWith("/messages")
          ? Response.json({
              messages: [
                { messageId: "m-1", contextId, role: "ROLE_USER", parts: [{ text: "hi" }] },
              ],
              nextPageToken: "",
              pageSize: 50,
            })
          : Response.json({
              contexts: [{ contextId, status: "open", createdAt: "2026-09-30T12:00:00Z" }],
              nextPageToken: "next",
              pageSize: 1,
            });
      },
    });

    expect((await client.listContexts({ pageSize: 1 })).nextPageToken).toBe("next");
    expect(
      (await client.listContextMessages(contextId, { pageToken: "a b" })).messages,
    ).toHaveLength(1);
    expect(requests.map(({ url }) => `${url.pathname}${url.search}`)).toEqual([
      `/a2a/${skylineCustomerId}/contexts?pageSize=1`,
      `/a2a/${skylineCustomerId}/contexts/${contextId}/messages?pageToken=a+b`,
    ]);
    expect(requests[0]?.init).toMatchObject({
      method: "GET",
      headers: { "A2A-Version": "1.0", Authorization: "Bearer token" },
    });
    expect(requests[0]?.init.body).toBeUndefined();
  });

  it("verifies callback signatures over the raw body", () => {
    const secret = "callback-secret";
    const body = JSON.stringify({ contextId: "ctx-1", status: "closed" });
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyContextCallback({ body, signature, secret })).toEqual({
      contextId: "ctx-1",
      status: "closed",
    });
    expect(
      verifyContextCallback({ body: new TextEncoder().encode(body), signature, secret }),
    ).toEqual({ contextId: "ctx-1", status: "closed" });
    for (const [tamperedBody, tamperedSignature] of [
      [body.replace("closed", "open"), signature],
      [body, signature.toUpperCase()],
      [body, null],
    ] as const) {
      expect(() =>
        verifyContextCallback({ body: tamperedBody, signature: tamperedSignature, secret }),
      ).toThrow("X-A2A-Signature");
    }
  });
});
