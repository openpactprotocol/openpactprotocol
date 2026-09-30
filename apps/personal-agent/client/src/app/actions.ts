"use server";

import { randomUUID } from "node:crypto";
import { A2AClient, createPlatformSigner, discoverAgent, registerPlatform } from "@pac2/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  defaultPlatformName,
  homePath,
  parseCustomerIds,
  USER_ID_COOKIE,
  USER_ID_COOKIE_OPTIONS,
  type RegistrationNotice,
} from "../lib/session.js";
import {
  getConversation,
  saveConversation,
  type BusinessThread,
  type PaConversation,
} from "../lib/conversationStore.js";
import { routeWithOpenAI } from "../lib/llmRouter.js";
import { routeMessage, type RoutableBusiness } from "../lib/router.js";

type Connection = { providerUrl: string; customerIds: string[] };
type DiscoveredBusiness = {
  customerId: string;
  name: string;
  description: string;
  url: string;
  keywords: string[];
  skills: { name: string; description: string }[];
};

function readConnection(formData: FormData): Connection {
  return {
    providerUrl:
      String(formData.get("providerUrl") ?? "").trim() ||
      process.env.PROVIDER_URL ||
      "http://localhost:3000",
    customerIds: parseCustomerIds(
      String(formData.get("customerIds") ?? process.env.CUSTOMER_IDS ?? ""),
    ),
  };
}

function createTimestampGenerator(previousTimestamp: string): () => string {
  let previousTime = Date.parse(previousTimestamp);
  return () => {
    const now = Date.now();
    previousTime = Math.max(now, Number.isFinite(previousTime) ? previousTime + 1 : now);
    return new Date(previousTime).toISOString();
  };
}

function lastAgentMessage(thread: BusinessThread): BusinessThread["messages"][number] | undefined {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message?.role === "ROLE_AGENT") return message;
  }
  return undefined;
}

function orderedAwaitingThreads(
  conversation: PaConversation,
  customerIds: string[],
): BusinessThread[] {
  const customerOrder = new Map(customerIds.map((customerId, index) => [customerId, index]));
  return conversation.threads
    .filter((thread) => thread.awaitingReply)
    .sort((first, second) => {
      const byMostRecentQuestion = (lastAgentMessage(second)?.at ?? "").localeCompare(
        lastAgentMessage(first)?.at ?? "",
      );
      if (byMostRecentQuestion !== 0) return byMostRecentQuestion;
      return (
        (customerOrder.get(first.customerId) ?? Number.MAX_SAFE_INTEGER) -
        (customerOrder.get(second.customerId) ?? Number.MAX_SAFE_INTEGER)
      );
    });
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

export async function sendChatMessage(formData: FormData): Promise<string> {
  const connection = readConnection(formData);
  const text = String(formData.get("text") ?? "");
  const requestedConversationId = String(formData.get("conversationId") ?? "");
  const userId = (await cookies()).get(USER_ID_COOKIE)?.value;
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  if (!userId) throw new Error("Missing user ID");
  if (!issuer || !privateJwk)
    throw new Error("Set PA_ISSUER and PA_PRIVATE_JWK in the server environment");
  let conversation = requestedConversationId
    ? await getConversation({
        userId,
        providerUrl: connection.providerUrl,
        id: requestedConversationId,
      })
    : undefined;
  if (!conversation) {
    const createdAt = new Date().toISOString();
    conversation = {
      id: randomUUID(),
      userId,
      providerUrl: connection.providerUrl.replace(/\/+$/, ""),
      messages: [],
      threads: [],
      createdAt,
      updatedAt: createdAt,
    };
  }
  if (!text.trim()) {
    return homePath({
      ...connection,
      ...(requestedConversationId ? { conversationId: conversation.id } : {}),
    });
  }

  const discoveries = await Promise.all(
    connection.customerIds.map(async (customerId): Promise<DiscoveredBusiness | undefined> => {
      try {
        const discovery = await discoverAgent(connection.providerUrl, customerId);
        return {
          customerId,
          name: discovery.card.name,
          description: discovery.card.description,
          url: discovery.url,
          keywords: [...new Set(discovery.card.skills.flatMap((skill) => skill.tags))],
          skills: discovery.card.skills.map(({ name, description }) => ({ name, description })),
        };
      } catch {
        return undefined;
      }
    }),
  );
  const businesses = discoveries.filter(
    (business): business is DiscoveredBusiness => business !== undefined,
  );
  const routableBusinesses: RoutableBusiness[] = businesses.map(
    ({ customerId, name, keywords }) => ({ customerId, name, keywords }),
  );
  const awaitingThreads = orderedAwaitingThreads(conversation, connection.customerIds);
  const awaitingCustomerIds = awaitingThreads.map((thread) => thread.customerId);
  const fallbackRoute = () =>
    routeMessage({ text, businesses: routableBusinesses, awaitingCustomerIds });
  let routes: string[];
  if (process.env.OPENAI_API_KEY && businesses.length > 0) {
    try {
      routes = await routeWithOpenAI({
        text,
        businesses: businesses.map(({ customerId, name, description, keywords, skills }) => ({
          customerId,
          name,
          description,
          keywords,
          skills,
        })),
        awaiting: awaitingThreads.map((thread) => ({
          customerId: thread.customerId,
          question: lastAgentMessage(thread)?.text ?? "",
        })),
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
      });
    } catch {
      routes = fallbackRoute();
    }
  } else {
    routes = fallbackRoute();
  }
  const nextTimestamp = createTimestampGenerator(conversation.updatedAt);
  const userAt = nextTimestamp();
  conversation.messages.push({ role: "user", text, at: userAt });

  if (routes.length === 0) {
    const responseAt = nextTimestamp();
    conversation.messages.push({
      role: "personal-agent",
      text: "No businesses are connected.",
      at: responseAt,
    });
    conversation.updatedAt = responseAt;
    await saveConversation(conversation);
    return homePath({ ...connection, conversationId: conversation.id });
  }

  const targets = routes.flatMap((customerId) => {
    const business = businesses.find((candidate) => candidate.customerId === customerId);
    return business ? [business] : [];
  });
  const signer = createPlatformSigner({ issuer, privateJwk });
  const outcomes = await Promise.all(
    targets.map(async (business) => {
      const thread = conversation.threads.find(
        (candidate) => candidate.customerId === business.customerId,
      );
      try {
        const client = new A2AClient({
          url: business.url,
          signer,
          userId,
          ...(process.env.PA_AUDIENCE ? { audience: process.env.PA_AUDIENCE } : {}),
        });
        const message = await client.sendMessage(
          text,
          thread ? { contextId: thread.contextId } : {},
        );
        if (!message.contextId) throw new Error("Agent response is missing contextId");
        return { business, message } as const;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error("Request failed");
        return { business, error } as const;
      }
    }),
  );
  const successfulOutcomes = outcomes.filter((outcome) => !("error" in outcome));
  const threadReplyAt = successfulOutcomes.length > 0 ? nextTimestamp() : undefined;

  for (const outcome of outcomes) {
    if ("error" in outcome) {
      const at = nextTimestamp();
      conversation.messages.push({
        role: "personal-agent",
        text: `Couldn't reach ${outcome.business.name}: ${outcome.error.message}`,
        at,
      });
      conversation.updatedAt = at;
      continue;
    }

    const replyText = outcome.message.parts
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n");
    const at = nextTimestamp();
    conversation.messages.push({
      role: "business",
      customerId: outcome.business.customerId,
      businessName: outcome.business.name,
      text: replyText,
      at,
    });

    const existingIndex = conversation.threads.findIndex(
      (thread) => thread.customerId === outcome.business.customerId,
    );
    const previousThread = existingIndex < 0 ? undefined : conversation.threads[existingIndex];
    const updatedThread: BusinessThread = {
      customerId: outcome.business.customerId,
      businessName: outcome.business.name,
      contextId: outcome.message.contextId!,
      messages: [
        ...(previousThread?.messages ?? []),
        { role: "ROLE_USER", text, at: userAt },
        { role: "ROLE_AGENT", text: replyText, at: threadReplyAt! },
      ],
      awaitingReply: replyText.trimEnd().endsWith("?"),
    };
    if (existingIndex < 0) conversation.threads.push(updatedThread);
    else conversation.threads[existingIndex] = updatedThread;
    conversation.updatedAt = at;
  }

  await saveConversation(conversation);
  return homePath({ ...connection, conversationId: conversation.id });
}
