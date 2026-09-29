import { generateKeyPair, exportJWK, jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { A2AClient, A2AHttpError, A2ARpcError, createPlatformSigner } from "../src/index.js";

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

  it("parses JSON-RPC and HTTP failures into typed errors", async () => {
    const signer = { sign: async () => "token" };
    const rpcClient = new A2AClient({
      url: "https://provider.example/a2a/acme",
      signer,
      userId: "demo",
      fetchImpl: async () =>
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32001, message: "Task not found", data: [] },
        }),
    });
    await expect(rpcClient.getTask("missing")).rejects.toBeInstanceOf(A2ARpcError);
    const httpClient = new A2AClient({
      url: "https://provider.example/a2a/acme",
      signer,
      userId: "demo",
      fetchImpl: async () => Response.json({ error: "unauthorized" }, { status: 401 }),
    });
    await expect(httpClient.getTask("missing")).rejects.toBeInstanceOf(A2AHttpError);
  });
});
