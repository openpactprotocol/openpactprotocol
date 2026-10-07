import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/client.js";
import { schema } from "../db/schema.js";
import { seedDatabase } from "../db/seed.js";
import { FLIGHT_REBOOK_TYPE } from "../../../brand/src/authorization.js";
import { createOAuthHandler } from "./oauth.js";
import { delegationUrls } from "./config.js";
import { verifyDelegationToken } from "./tokens.js";

const origin = "http://provider.test";
const pa = "http://pa.test";
const brand = "http://brand.test";
const details = [
  { type: FLIGHT_REBOOK_TYPE, identifier: "K7PQ2M", actions: ["rebook"], target_flight: "SK 318" },
];
let database: PGlite;
let handler: ReturnType<typeof createOAuthHandler>;
let key: CryptoKey;
let customerId: string;
let urls: ReturnType<typeof delegationUrls>;
const env = {
  PROVIDER_URL: origin,
  BRAND_URL: brand,
  DELEGATION_ENABLED: "1",
  A2A_AUDIENCE: `${origin}/a2a`,
};
const savedEnv = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));

async function post(path: string, form: Record<string, string>, authenticate = true) {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (authenticate)
    headers.Authorization = `Bearer ${await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: "test" }).setIssuer(pa).setSubject("user-1").setAudience(`${origin}/a2a`).setIssuedAt().setExpirationTime("120s").sign(key)}`;
  return handler(
    new Request(`${urls.issuer}/${path}`, {
      method: "POST",
      headers,
      body: new URLSearchParams(form),
    }),
    customerId,
    path.split("/"),
  );
}
async function start(scope: string, authorizationDetails?: unknown) {
  return post("device_authorization", {
    client_id: pa,
    scope,
    ...(authorizationDetails === undefined
      ? {}
      : { authorization_details: JSON.stringify(authorizationDetails) }),
  });
}
async function approve(device: { user_code: string }, scopes: string[], decision = "allow") {
  const assertion = await new SignJWT({ user_code: device.user_code, email: "alex@example.com" })
    .setProtectedHeader({ alg: "ES256", kid: "test" })
    .setIssuer(brand)
    .setAudience(urls.consent)
    .setSubject("sky-4471")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("120s")
    .sign(key);
  const consent = await post("consent", { assertion }, false);
  expect(consent.status).toBe(200);
  const html = await consent.text();
  const session = html.match(/name="session"[^>]*value="([^"]+)"/)?.[1];
  expect(session).toBeDefined();
  const form = new URLSearchParams({ session: session!, decision });
  for (const scope of scopes) form.append("scope", scope);
  const response = await handler(
    new Request(urls.consentDecision, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    }),
    customerId,
    ["consent", "decision"],
  );
  expect(response.status).toBe(303);
  return html;
}
async function poll(device: { device_code: string }) {
  return post("token", {
    client_id: pa,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: device.device_code,
  });
}

describe("resource-bound OAuth grants", () => {
  beforeAll(async () => {
    Object.assign(process.env, env);
    const pair = await generateKeyPair("ES256", { extractable: true });
    key = pair.privateKey;
    const jwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test", alg: "ES256" }],
    });
    database = new PGlite();
    const db = drizzle(database, { schema });
    await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
    const typedDb = db as unknown as Db;
    customerId = (await seedDatabase(typedDb, pa)).skylineId;
    urls = delegationUrls(origin, customerId);
    handler = createOAuthHandler({ db: typedDb, getJwks: () => jwks });
  });
  afterAll(async () => {
    await database?.close();
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  it("advertises the Brand's supported type", async () => {
    const response = await handler(new Request(urls.metadata), customerId, [
      ".well-known",
      "oauth-authorization-server",
    ]);
    expect((await response.json()).authorization_details_types_supported).toEqual([
      FLIGHT_REBOOK_TYPE,
    ]);
  });
  it("rejects unknown types, fields, invalid details, and missing associated scopes", async () => {
    for (const value of [
      [],
      null,
      [{ ...details[0], type: "unknown" }],
      [{ ...details[0], max_fee: 0 }],
      [{ ...details[0], actions: ["cancel"] }],
    ]) {
      const response = await start("flights:rebook", value);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_authorization_details");
    }
    expect((await (await start("flights:upcoming:read", details)).json()).error).toBe(
      "invalid_authorization_details",
    );
    expect(
      (
        await (
          await post("device_authorization", {
            client_id: pa,
            scope: "flights:rebook",
            authorization_details: "{",
          })
        ).json()
      ).error,
    ).toBe("invalid_authorization_details");
  });
  it("shows and signs the approved conditions, preserving them on refresh", async () => {
    const device = await (await start("flights:rebook", details)).json();
    expect(await approve(device, ["flights:rebook"])).toContain(
      "Only reservation K7PQ2M, to flight SK 318",
    );
    const token = await (await poll(device)).json();
    expect(token.authorization_details).toEqual(details);
    const verified = await verifyDelegationToken(token.access_token, {
      issuer: urls.issuer,
      audience: urls.interfaceUrl,
      now: new Date(),
    });
    expect(verified.authorization_details).toEqual(details);
    const refresh = await post("token", {
      client_id: pa,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    });
    expect(refresh.status).toBe(200);
    const refreshed = await refresh.json();
    expect(refreshed.authorization_details).toEqual(details);
    expect(
      (
        await verifyDelegationToken(refreshed.access_token, {
          issuer: urls.issuer,
          audience: urls.interfaceUrl,
          now: new Date(),
        })
      ).authorization_details,
    ).toEqual(details);
  });
  it("requires fresh consent for another requested resource", async () => {
    const changed = [{ ...details[0], identifier: "OTHER" }];
    const device = await (await start("flights:rebook", changed)).json();
    expect((await (await poll(device)).json()).error).toBe("authorization_pending");
    expect(await approve(device, ["flights:rebook"])).toContain(
      "Only reservation OTHER, to flight SK 318",
    );
    expect((await (await poll(device)).json()).authorization_details).toEqual(changed);
  });
  it("drops the associated details when the User declines rebooking", async () => {
    const device = await (await start("flights:upcoming:read flights:rebook", details)).json();
    await approve(device, ["flights:upcoming:read"]);
    const token = await (await poll(device)).json();
    expect(token.scope).toBe("flights:upcoming:read");
    expect(token.authorization_details).toBeUndefined();
    expect(
      (
        await verifyDelegationToken(token.access_token, {
          issuer: urls.issuer,
          audience: urls.interfaceUrl,
          now: new Date(),
        })
      ).authorization_details,
    ).toBeUndefined();
  });
  it("preserves scope-only grants", async () => {
    const device = await (await start("flights:rebook")).json();
    await approve(device, ["flights:rebook"]);
    const token = await (await poll(device)).json();
    expect(token.scope).toBe("flights:rebook");
    expect(token.authorization_details).toBeUndefined();
  });
});
