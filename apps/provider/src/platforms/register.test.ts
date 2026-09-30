import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type GenerateKeyPairResult,
  type JWK,
  type JWTVerifyGetKey,
} from "jose";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createA2AHandler, type A2AHandler } from "../a2a/handler.js";
import { seedDatabase } from "../db/seed.js";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { conversations } from "../db/schema.js";
import { createRegisterPlatformHandler } from "./register.js";

const issuer = "https://instinct.example";
const origin = "http://localhost:3000";
const registrationAudience = `${origin}/api/platforms`;

let client: PGlite;
let testDb: Db;
let customerIds: { skylineId: string; loomId: string; bloomId: string };
let keyPair: GenerateKeyPairResult;
let kid: string;
let localJwks: JWTVerifyGetKey;
let registerHandler: (request: Request) => Promise<Response>;
let a2aHandler: A2AHandler;

type TokenInput = {
  issuer?: string;
  sub?: string;
  audience?: string;
  iat?: number;
  exp?: number;
  key?: CryptoKey;
  algorithm?: "ES256" | "HS256";
  kid?: string;
};

async function token(input: TokenInput = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenIssuer = input.issuer ?? issuer;
  const algorithm = input.algorithm ?? "ES256";
  const signingKey =
    algorithm === "HS256"
      ? new TextEncoder().encode("wrong-algorithm-key")
      : (input.key ?? keyPair.privateKey);
  return new SignJWT({})
    .setProtectedHeader({ alg: algorithm, kid: input.kid ?? kid, typ: "JWT" })
    .setIssuer(tokenIssuer)
    .setSubject(input.sub ?? tokenIssuer)
    .setAudience(input.audience ?? registrationAudience)
    .setIssuedAt(input.iat ?? now)
    .setExpirationTime(input.exp ?? now + 120)
    .setJti(crypto.randomUUID())
    .sign(signingKey);
}

async function register(
  body: unknown,
  options: {
    token?: string | null;
    tokenInput?: TokenInput;
    contentType?: string | null;
  } = {},
): Promise<Response> {
  const authorization =
    options.token === null ? undefined : (options.token ?? (await token(options.tokenInput)));
  const headers = new Headers();
  if (authorization) headers.set("Authorization", `Bearer ${authorization}`);
  if (options.contentType !== null) {
    headers.set("Content-Type", options.contentType ?? "application/json");
  }
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  return registerHandler(
    new Request(`${origin}/api/platforms`, {
      method: "POST",
      headers,
      body: bodyText,
    }),
  );
}

function registrationBody(
  name: string,
  platformIssuer = issuer,
  jwksUri = `${platformIssuer}/.well-known/jwks.json`,
) {
  return { name, jwksUri };
}

async function expectUnauthorized(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe('Bearer realm="platforms"');
  expect(await response.text()).toBe("");
}

beforeAll(async () => {
  keyPair = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = (await exportJWK(keyPair.publicKey)) as JWK;
  kid = await calculateJwkThumbprint(publicJwk);
  publicJwk.kid = kid;
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";
  localJwks = createLocalJWKSet({ keys: [publicJwk] });

  client = new PGlite();
  const drizzleClient = drizzle(client, { schema });
  await migrate(drizzleClient, {
    migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
  });
  testDb = drizzleClient as unknown as Db;
  customerIds = await seedDatabase(testDb, "http://localhost:3002", { seedDemoPlatform: true });
  registerHandler = createRegisterPlatformHandler({
    db: testDb,
    getJwks: () => localJwks,
  });
  a2aHandler = createA2AHandler({
    db: testDb,
    getJwks: () => localJwks,
  });
});

afterAll(async () => {
  await client.close();
});

describe("platform registration", () => {
  it("registers a fresh platform that can authenticate A2A requests", async () => {
    const response = await register(registrationBody("instinct"));
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      platform: { id: string; name: string; issuer: string; jwksUri: string; enabled: boolean };
    };
    expect(body.platform).toMatchObject({
      name: "instinct",
      issuer,
      jwksUri: `${issuer}/.well-known/jwks.json`,
      enabled: true,
    });

    const sub = "instinct-user";
    const a2aToken = await token({
      sub,
      audience: `${origin}/a2a`,
    });
    const messageResponse = await a2aHandler(
      new Request(`${origin}/a2a/${customerIds.skylineId}/message:send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${a2aToken}`,
          "A2A-Version": "1.0",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            role: "ROLE_USER",
            messageId: crypto.randomUUID(),
            parts: [{ text: "Is my Friday flight on time?" }],
          },
        }),
      }),
      customerIds.skylineId,
      ["message:send"],
    );
    expect(messageResponse.status).toBe(200);
    const messageBody = (await messageResponse.json()) as {
      message: { contextId: string; role: string };
    };
    expect(messageBody.message.role).toBe("ROLE_AGENT");
    const conversation = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, messageBody.message.contextId),
    });
    expect(conversation?.userId).toBe(`instinct:${sub}`);
  });

  it("returns the existing platform for an identical assertion without replay tracking", async () => {
    const platformIssuer = "https://repeat.example";
    const signedToken = await token({
      issuer: platformIssuer,
      sub: platformIssuer,
    });
    const body = registrationBody("repeat-pa", platformIssuer);
    const created = await register(body, { token: signedToken });
    const repeated = await register(body, { token: signedToken });
    expect(created.status).toBe(201);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(await created.json());
  });

  it("preserves a signed issuer's trailing slash", async () => {
    const trailingIssuer = "https://trailing.example/";
    const response = await register(
      registrationBody(
        "trailing-pa",
        trailingIssuer,
        "https://trailing.example/.well-known/jwks.json",
      ),
      { tokenInput: { issuer: trailingIssuer } },
    );
    expect(response.status).toBe(201);
    expect((await response.json()).platform.issuer).toBe(trailingIssuer);
  });

  it("rejects issuer, name, and JWKS conflicts", async () => {
    const sameIssuerDifferentName = await register(registrationBody("instinct-alt"));
    expect(sameIssuerDifferentName.status).toBe(409);

    const anotherIssuer = "https://other-platform.example";
    const sameNameDifferentIssuer = await register(registrationBody("instinct", anotherIssuer), {
      tokenInput: { issuer: anotherIssuer },
    });
    expect(sameNameDifferentIssuer.status).toBe(409);

    const differentJwks = await register(
      registrationBody("instinct", issuer, `${issuer}/keys/alternate.json`),
    );
    expect(differentJwks.status).toBe(409);
  });

  it("does not re-enable a disabled platform during re-registration", async () => {
    const disabledIssuer = "https://disabled.example";
    const disabledJwksUri = `${disabledIssuer}/.well-known/jwks.json`;
    await testDb.insert(schema.agentPlatforms).values({
      name: "paused-pa",
      issuer: disabledIssuer,
      jwksUri: disabledJwksUri,
      enabled: false,
    });
    const response = await register(registrationBody("paused-pa", disabledIssuer), {
      tokenInput: { issuer: disabledIssuer },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).platform.enabled).toBe(false);
  });

  it("returns bare 401 for missing and invalid assertions", async () => {
    await expectUnauthorized(await register(registrationBody("missing-token"), { token: null }));

    const wrongKeyPair = await generateKeyPair("ES256", { extractable: true });
    await expectUnauthorized(
      await register(registrationBody("wrong-signature"), {
        tokenInput: { key: wrongKeyPair.privateKey, kid: `unknown-${kid}` },
      }),
    );
    await expectUnauthorized(
      await register(registrationBody("wrong-audience"), {
        tokenInput: { audience: `${origin}/not-platforms` },
      }),
    );
    await expectUnauthorized(
      await register(registrationBody("wrong-subject"), {
        tokenInput: { sub: "not-the-issuer" },
      }),
    );

    const now = Math.floor(Date.now() / 1000);
    await expectUnauthorized(
      await register(registrationBody("long-lived"), {
        tokenInput: { iat: now, exp: now + 301 },
      }),
    );
    await expectUnauthorized(
      await register(registrationBody("future-iat"), {
        tokenInput: { iat: now + 31, exp: now + 120 },
      }),
    );
    await expectUnauthorized(
      await register(registrationBody("wrong-algorithm"), {
        tokenInput: { algorithm: "HS256" },
      }),
    );
  });

  it("returns 400 for invalid registration bodies and URLs", async () => {
    expect((await register(registrationBody("Invalid Name"))).status).toBe(400);
    expect((await register("{", { contentType: "application/json" })).status).toBe(400);
    expect(
      (await register(registrationBody("wrong-content-type"), { contentType: "text/plain" }))
        .status,
    ).toBe(400);
    expect(
      (await register(registrationBody("cross-origin", issuer, "https://other.example/jwks.json")))
        .status,
    ).toBe(400);
    expect(
      (await register(registrationBody("ftp-uri", issuer, "ftp://instinct.example/jwks.json")))
        .status,
    ).toBe(400);
    const nonLocalIssuer = "http://not-local.example";
    expect(
      (
        await register(registrationBody("non-local-http", nonLocalIssuer), {
          tokenInput: { issuer: nonLocalIssuer },
        })
      ).status,
    ).toBe(400);
  });

  it("can skip only the demo platform during seeding", async () => {
    await testDb.delete(schema.agentPlatforms).where(eq(schema.agentPlatforms.name, "demo-pa"));
    await seedDatabase(testDb, "http://localhost:3002", { seedDemoPlatform: false });
    const demoPlatform = await testDb.query.agentPlatforms.findFirst({
      where: eq(schema.agentPlatforms.name, "demo-pa"),
    });
    const disabledPlatform = await testDb.query.agentPlatforms.findFirst({
      where: eq(schema.agentPlatforms.name, "disabled-pa"),
    });
    expect(demoPlatform).toBeUndefined();
    expect(disabledPlatform?.enabled).toBe(false);
  });
});
