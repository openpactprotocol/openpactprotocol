#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { A2AClient, createPlatformSigner, fetchAgentCard, interfaceUrl } from "./index.js";

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

function signer(): { sign(sub: string): Promise<string> } {
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  const aud = process.env.PA_AUDIENCE;
  if (!issuer || !privateJwk || !aud)
    throw new Error("Set PA_ISSUER, PA_PRIVATE_JWK, and PA_AUDIENCE");
  const platformSigner = createPlatformSigner({ issuer, privateJwk });
  return { sign: (sub) => platformSigner.sign({ sub, aud }) };
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
  const paSigner = signer();
  const client = new A2AClient({ url: interfaceUrl(card), getToken: () => paSigner.sign(userId) });
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
