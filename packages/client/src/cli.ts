#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importJWK, SignJWT, type JWK } from "jose";
import { A2AClient, fetchAgentCard, interfaceUrl } from "./index.js";

const envFile = fileURLToPath(
  new URL("../../../reference/personal-agent/client/.env.local", import.meta.url),
);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match?.[1] || process.env[match[1]]) continue;
    process.env[match[1]] = (match[2] ?? "").replace(/^['"]|['"]$/g, "");
  }
}

const userId = process.env.PA_USER_ID ?? "demo-user";
const [command = "help", ...args] = process.argv.slice(2);

const usage = "Usage: pact card | send <text> [--context <id>] | chat";

function cardUrl(): string {
  if (process.env.AGENT_CARD_URL) return process.env.AGENT_CARD_URL;
  const providerUrl = process.env.PROVIDER_URL;
  const customerId = process.env.CUSTOMER_ID;
  if (!providerUrl || !customerId)
    throw new Error("Set AGENT_CARD_URL, or PROVIDER_URL and CUSTOMER_ID");
  return `${providerUrl.replace(/\/+$/, "")}/a2a/${encodeURIComponent(customerId)}/.well-known/agent-card.json`;
}

async function signPaJwt(sub: string): Promise<string> {
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  const audience = process.env.PA_AUDIENCE;
  if (!issuer || !privateJwk || !audience) {
    throw new Error("Set PA_ISSUER, PA_PRIVATE_JWK, and PA_AUDIENCE");
  }
  const jwk = JSON.parse(privateJwk) as JWK;
  if (typeof jwk.kid !== "string") throw new Error("PA_PRIVATE_JWK must include kid");
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 120)
    .setJti(randomUUID())
    .sign(await importJWK(jwk, "ES256"));
}

async function main(): Promise<void> {
  if (!["card", "send", "chat"].includes(command)) {
    console.log(usage);
    return;
  }

  const card = await fetchAgentCard(cardUrl());
  if (command === "card") {
    console.log(JSON.stringify(card, null, 2));
    return;
  }
  const client = new A2AClient({ url: interfaceUrl(card), getToken: () => signPaJwt(userId) });
  if (command === "send") {
    const contextIndex = args.indexOf("--context");
    const contextId = contextIndex < 0 ? undefined : args[contextIndex + 1];
    if (contextIndex >= 0 && !contextId) throw new Error("--context requires a value");
    const textArgs =
      contextIndex < 0
        ? args
        : args.filter((_, index) => index !== contextIndex && index !== contextIndex + 1);
    const text = textArgs.join(" ");
    const message = await client.sendMessage(text, contextId ? { contextId } : {});
    console.log(JSON.stringify(message, null, 2));
  } else if (command === "chat") {
    const terminal = createInterface({ input, output });
    let contextId: string | undefined;
    try {
      while (true) {
        const text = await terminal.question("> ");
        if (text === "/exit") break;
        const message = await client.sendMessage(text, contextId ? { contextId } : {});
        contextId = message.contextId;
        console.log(message.parts.map((part) => ("text" in part ? part.text : "")).join(""));
      }
    } finally {
      terminal.close();
    }
  }
}

await main();
