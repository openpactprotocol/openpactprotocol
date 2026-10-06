import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  type CryptoKey,
  type JSONWebKeySet,
  type JWK,
} from "jose";

export type SigningKey = {
  privateKey: CryptoKey;
  kid: string;
  alg: "ES256";
  jwks: JSONWebKeySet;
};

let cached: Promise<SigningKey> | undefined;

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// PROVIDER_PRIVATE_JWK, else a key generated once and kept in .data/.
async function loadPrivateJwk(): Promise<JWK> {
  const fromEnv = process.env.PROVIDER_PRIVATE_JWK;
  if (fromEnv) return JSON.parse(fromEnv) as JWK;
  const path = resolve(process.cwd(), ".data/provider-signing-key.json");
  try {
    return JSON.parse(await readFile(path, "utf8")) as JWK;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, JSON.stringify(jwk), { mode: 0o600, flag: "wx" });
    return jwk;
  } catch {
    return JSON.parse(await readFile(path, "utf8")) as JWK;
  }
}

export function getSigningKey(): Promise<SigningKey> {
  cached ??= (async () => {
    const jwk = await loadPrivateJwk();
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
      throw new Error("PROVIDER_PRIVATE_JWK must be a P-256 (ES256) private JWK");
    }
    const publicJwk: JWK = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
    const kid = jwk.kid ?? (await calculateJwkThumbprint(publicJwk, "sha256"));
    const privateKey = (await importJWK(jwk, "ES256")) as CryptoKey;
    return {
      privateKey,
      kid,
      alg: "ES256",
      jwks: { keys: [{ ...publicJwk, kid, alg: "ES256", use: "sig" }] },
    };
  })();
  cached.catch(() => {
    cached = undefined;
  });
  return cached;
}
