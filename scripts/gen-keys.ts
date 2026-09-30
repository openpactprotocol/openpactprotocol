import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";

const force = process.argv.includes("--force");
const jwksPath = "reference/personal-agent/server/public/.well-known/jwks.json";
const envPath = "reference/personal-agent/client/.env.local";
const existingJwks = existsSync(jwksPath) ? readFileSync(jwksPath, "utf8").trim() : "";
const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const existingPrivateJwk = env.match(/^PA_PRIVATE_JWK\s*=/m);
let hasExistingKeys = false;
if (existingJwks) {
  try {
    const jwks: unknown = JSON.parse(existingJwks);
    hasExistingKeys =
      typeof jwks !== "object" ||
      jwks === null ||
      !("keys" in jwks) ||
      !Array.isArray(jwks.keys) ||
      jwks.keys.length > 0;
  } catch {
    hasExistingKeys = true;
  }
}
if (!force && (hasExistingKeys || existingPrivateJwk)) {
  throw new Error("A key already exists; pass --force to replace it.");
}

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const publicJwk = await exportJWK(publicKey);
const privateJwk = await exportJWK(privateKey);
const kid = await calculateJwkThumbprint(publicJwk, "sha256");
const publicEntry = { ...publicJwk, kid, alg: "ES256", use: "sig" };
const privateEntry = { ...privateJwk, kid, alg: "ES256", use: "sig" };
writeFileSync(jwksPath, `${JSON.stringify({ keys: [publicEntry] }, null, 2)}\n`, { mode: 0o644 });
const lines = env.split(/\r?\n/).filter((line) => !line.startsWith("PA_PRIVATE_JWK="));
while (lines.at(-1) === "") lines.pop();
lines.push(`PA_PRIVATE_JWK='${JSON.stringify(privateEntry)}'`);
writeFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(`Wrote public JWKS to ${jwksPath} and private key to ${envPath}`);
