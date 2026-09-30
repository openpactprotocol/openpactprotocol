#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { A2AClient, createPlatformSigner, discoverAgent, registerPlatform } from "./index.js";

const envFile = fileURLToPath(
  new URL("../../../apps/personal-agent/client/.env.local", import.meta.url),
);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match?.[1] || process.env[match[1]]) continue;
    process.env[match[1]] = (match[2] ?? "").replace(/^['"]|['"]$/g, "");
  }
}

const providerUrl = process.env.PROVIDER_URL;
const slug = process.env.CUSTOMER_SLUG;
const issuer = process.env.PA_ISSUER;
const privateJwk = process.env.PA_PRIVATE_JWK;
const userId = process.env.PA_USER_ID ?? "demo-user";
const [command = "help", ...args] = process.argv.slice(2);

const usage =
  "Usage: pap register [--name <name>] [--jwks-uri <url>] | card | send <text> [--task id] | get <id> | list | cancel <id> | chat";

async function main(): Promise<void> {
  if (command === "help" || command === "--help") {
    console.log(usage);
    return;
  }
  if (!providerUrl) throw new Error("Set PROVIDER_URL");

  if (command === "register") {
    if (!issuer || !privateJwk) throw new Error("Set PA_ISSUER and PA_PRIVATE_JWK");
    let name = process.env.PA_PLATFORM_NAME || "demo-pa";
    let jwksUri: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--name" || argument === "--jwks-uri") {
        const value = args[index + 1];
        if (!value) throw new Error(`${argument} requires a value`);
        if (argument === "--name") name = value;
        else jwksUri = value;
        index += 1;
      } else {
        throw new Error(`Unknown register option: ${argument}`);
      }
    }
    const result = await registerPlatform({
      providerUrl,
      name,
      ...(jwksUri === undefined ? {} : { jwksUri }),
      signer: createPlatformSigner({ issuer, privateJwk }),
    });
    console.log(
      `${result.created ? "created" : "already registered"}\n${JSON.stringify(result.platform, null, 2)}`,
    );
    return;
  }

  if (!["card", "send", "get", "list", "cancel", "chat"].includes(command)) {
    console.log(usage);
    return;
  }
  if (!slug) throw new Error("Set CUSTOMER_SLUG");

  const discovered = await discoverAgent(providerUrl, slug);
  if (command === "card") {
    console.log(JSON.stringify(discovered.card, null, 2));
    return;
  }
  if (!issuer || !privateJwk) throw new Error("Set PA_ISSUER and PA_PRIVATE_JWK");
  const signer = createPlatformSigner({ issuer, privateJwk });
  const client = new A2AClient({ url: discovered.url, signer, userId });
  if (command === "send") {
    const taskIndex = args.indexOf("--task");
    const textArgs =
      taskIndex < 0
        ? args
        : args.filter((_, index) => index !== taskIndex && index !== taskIndex + 1);
    const text = textArgs.join(" ");
    const taskId = taskIndex >= 0 ? args[taskIndex + 1] : undefined;
    console.log(JSON.stringify(await client.sendMessage(text, taskId ? { taskId } : {}), null, 2));
  } else if (command === "get") {
    console.log(JSON.stringify(await client.getTask(args[0] ?? ""), null, 2));
  } else if (command === "list") {
    console.log(JSON.stringify(await client.listTasks(), null, 2));
  } else if (command === "cancel") {
    console.log(JSON.stringify(await client.cancelTask(args[0] ?? ""), null, 2));
  } else if (command === "chat") {
    const terminal = createInterface({ input, output });
    let taskId: string | undefined;
    try {
      while (true) {
        const text = await terminal.question("> ");
        if (text === "/exit") break;
        const result = await client.sendMessage(text, taskId ? { taskId } : {});
        taskId = result.task.id;
        console.log(
          result.task.status.message?.parts
            .map((part) => ("text" in part ? part.text : ""))
            .join(""),
        );
      }
    } finally {
      terminal.close();
    }
  }
}

await main();
