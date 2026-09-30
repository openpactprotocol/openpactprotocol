"use server";

import { randomUUID } from "node:crypto";
import { A2AClient, createPlatformSigner, discoverAgent, registerPlatform } from "@pap/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  defaultPlatformName,
  homePath,
  USER_ID_COOKIE,
  USER_ID_COOKIE_OPTIONS,
  type RegistrationNotice,
} from "../lib/session.js";
import { saveConversationTurn } from "../lib/conversationStore.js";

type Connection = { providerUrl: string; customerId: string };

function readConnection(formData: FormData): Connection {
  return {
    providerUrl:
      String(formData.get("providerUrl") ?? "").trim() ||
      process.env.PROVIDER_URL ||
      "http://localhost:3000",
    customerId: String(formData.get("customerId") ?? "").trim() || process.env.CUSTOMER_ID || "",
  };
}

async function setUserId(userId: string): Promise<void> {
  (await cookies()).set(USER_ID_COOKIE, userId, USER_ID_COOKIE_OPTIONS);
}

export async function connect(formData: FormData): Promise<void> {
  const userId = String(formData.get("userId") ?? "").trim();
  if (userId) await setUserId(userId);
  redirect(homePath(readConnection(formData)));
}

export async function newUser(formData: FormData): Promise<void> {
  await setUserId(randomUUID());
  redirect(homePath(readConnection(formData)));
}

export async function registerPersonalAgent(formData: FormData): Promise<void> {
  const connection = readConnection(formData);
  const name = defaultPlatformName();
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  if (!issuer || !privateJwk)
    throw new Error("Set PA_ISSUER and PA_PRIVATE_JWK in the server environment");
  let registration: RegistrationNotice;
  try {
    const result = await registerPlatform({
      providerUrl: connection.providerUrl,
      name,
      signer: createPlatformSigner({ issuer, privateJwk }),
    });
    registration = { status: result.created ? "created" : "existing", name };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Registration failed";
    registration = { status: "error", name, message };
  }
  redirect(homePath({ ...connection, registration }));
}

export async function sendChatMessage(formData: FormData): Promise<void> {
  const connection = readConnection(formData);
  const text = String(formData.get("text") ?? "").trim();
  const contextId = String(formData.get("contextId") ?? "");
  const userId = (await cookies()).get(USER_ID_COOKIE)?.value;
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  if (!userId) throw new Error("Missing user ID");
  if (!issuer || !privateJwk)
    throw new Error("Set PA_ISSUER and PA_PRIVATE_JWK in the server environment");
  if (!text) redirect(homePath({ ...connection, ...(contextId ? { contextId } : {}) }));
  const discovered = await discoverAgent(connection.providerUrl, connection.customerId);
  const client = new A2AClient({
    url: discovered.url,
    signer: createPlatformSigner({ issuer, privateJwk }),
    userId,
    ...(process.env.PA_AUDIENCE ? { audience: process.env.PA_AUDIENCE } : {}),
  });
  const message = await client.sendMessage(text, contextId ? { contextId } : {});
  if (!message.contextId) throw new Error("Agent response is missing contextId");
  await saveConversationTurn({
    userId,
    providerUrl: connection.providerUrl,
    customerId: connection.customerId,
    contextId: message.contextId,
    userText: text,
    agentText: message.parts.map((part) => ("text" in part ? part.text : "")).join("\n"),
  });
  redirect(homePath({ ...connection, contextId: message.contextId }));
}
