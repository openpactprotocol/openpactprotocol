import { randomUUID } from "node:crypto";
import { A2AClient } from "@pact/client";
import { discoverAgent, signPaJwt } from "./pact.js";
import { composeFallbackReply } from "./composer.js";
import {
  getConversation,
  saveConversation,
  type BusinessThread,
  type PaConversation,
  type PhoneMessage,
} from "./conversationStore.js";
import { runPersonalAgent } from "./paAgent.js";
import { DEMO_USER_PROFILE } from "./userProfile.js";
import { homePath } from "./session.js";
import { routeMessage, type RoutableBusiness } from "./router.js";
import type { TurnEvent } from "./turnEvents.js";

type Connection = { providerUrl: string; customerIds: string[] };
type DiscoveredBusiness = {
  customerId: string;
  name: string;
  description: string;
  url: string;
  keywords: string[];
  skills: { name: string; description: string }[];
};
type BusinessOutcome =
  | { customerId: string; businessName: string; reply: string; waitingOnUser: boolean }
  | { customerId: string; businessName: string; unreachable: string };

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

function createConversation(input: { userId: string; providerUrl: string }): PaConversation {
  const createdAt = new Date().toISOString();
  return {
    id: randomUUID(),
    userId: input.userId,
    providerUrl: input.providerUrl.replace(/\/+$/, ""),
    messages: [],
    threads: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function transcriptMessages(messages: PhoneMessage[]): {
  role: "user" | "personal-agent";
  text: string;
}[] {
  return messages.flatMap((message) =>
    message.role === "user" || message.role === "personal-agent"
      ? [{ role: message.role, text: message.text }]
      : [],
  );
}

function normalizeParallelReplyTimestamps(
  conversation: PaConversation,
  customerIds: string[],
  nextTimestamp: () => string,
): void {
  if (customerIds.length === 0) return;
  const normalizedAt = nextTimestamp();
  const repliedCustomerIds = new Set(customerIds);
  for (const thread of conversation.threads) {
    if (!repliedCustomerIds.has(thread.customerId)) continue;
    let lastAgentIndex = -1;
    for (let index = 0; index < thread.messages.length; index += 1) {
      if (thread.messages[index]?.role === "ROLE_AGENT") lastAgentIndex = index;
    }
    const lastAgentMessage = thread.messages[lastAgentIndex];
    if (lastAgentMessage) {
      thread.messages[lastAgentIndex] = { ...lastAgentMessage, at: normalizedAt };
    }
  }
  conversation.updatedAt = normalizedAt;
}

export async function runTurn(
  input: {
    connection: Connection;
    text: string;
    conversationId: string;
    userId: string;
    issuer: string;
    privateJwk: string;
    audience: string;
  },
  emit: (event: TurnEvent) => void,
): Promise<void> {
  const { connection, text } = input;
  const existingConversation = input.conversationId
    ? await getConversation({
        userId: input.userId,
        providerUrl: connection.providerUrl,
        id: input.conversationId,
      })
    : undefined;
  const conversation =
    existingConversation ??
    createConversation({
      userId: input.userId,
      providerUrl: connection.providerUrl,
    });
  if (!text.trim()) {
    emit({
      type: "done",
      href: homePath({
        ...connection,
        ...(input.conversationId ? { conversationId: conversation.id } : {}),
      }),
    });
    return;
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
  const nextTimestamp = createTimestampGenerator(conversation.updatedAt);
  const transcript = transcriptMessages(conversation.messages);
  const userAt = nextTimestamp();
  conversation.messages.push({ role: "user", text, at: userAt });

  if (businesses.length === 0) {
    const message: PhoneMessage = {
      role: "personal-agent",
      text: "No businesses are connected.",
      at: nextTimestamp(),
    };
    conversation.messages.push(message);
    conversation.updatedAt = message.at;
    emit({ type: "reply", message });
    await saveConversation(conversation);
    emit({
      type: "done",
      href: homePath({ ...connection, conversationId: conversation.id }),
    });
    return;
  }

  const outcomes: BusinessOutcome[] = [];

  async function sendToBusiness(customerId: string, message: string): Promise<string> {
    const business = businesses.find((candidate) => candidate.customerId === customerId);
    if (!business) throw new Error(`Unknown business customerId: ${customerId}`);
    emit({
      type: "business-start",
      customerId: business.customerId,
      businessName: business.name,
      text: message,
    });
    try {
      const client = new A2AClient({
        url: business.url,
        getToken: () =>
          signPaJwt({
            issuer: input.issuer,
            privateJwk: input.privateJwk,
            sub: input.userId,
            aud: input.audience,
          }),
      });
      const previousThread = conversation.threads.find(
        (thread) => thread.customerId === business.customerId,
      );
      const response = await client.sendMessage(
        message,
        previousThread ? { contextId: previousThread.contextId } : {},
      );
      if (!response.contextId) throw new Error("Agent response is missing contextId");
      const reply = response.parts.map((part) => ("text" in part ? part.text : "")).join("\n");
      const businessMessageAt = nextTimestamp();
      const replyAt = nextTimestamp();
      const existingIndex = conversation.threads.findIndex(
        (thread) => thread.customerId === business.customerId,
      );
      const currentThread = existingIndex < 0 ? undefined : conversation.threads[existingIndex];
      const updatedThread: BusinessThread = {
        customerId: business.customerId,
        businessName: business.name,
        contextId: response.contextId,
        messages: [
          ...(currentThread?.messages ?? []),
          { role: "ROLE_USER", text: message, at: businessMessageAt },
          { role: "ROLE_AGENT", text: reply, at: replyAt },
        ],
        awaitingReply: reply.trimEnd().endsWith("?"),
      };
      if (existingIndex < 0) conversation.threads.push(updatedThread);
      else conversation.threads[existingIndex] = updatedThread;
      conversation.updatedAt = replyAt;
      outcomes.push({
        customerId: business.customerId,
        businessName: business.name,
        reply,
        waitingOnUser: updatedThread.awaitingReply,
      });
      emit({ type: "business", thread: updatedThread });
      return reply;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Request failed";
      outcomes.push({
        customerId: business.customerId,
        businessName: business.name,
        unreachable: business.name,
      });
      emit({
        type: "business-error",
        customerId: business.customerId,
        businessName: business.name,
        message,
      });
      throw cause;
    }
  }

  function appendPhoneMessage(messageText: string): void {
    const message: PhoneMessage = {
      role: "personal-agent",
      text: messageText,
      at: nextTimestamp(),
    };
    conversation.messages.push(message);
    conversation.updatedAt = message.at;
    emit({ type: "reply", message });
  }

  function composeOutcomes(): string {
    return composeFallbackReply({
      replies: outcomes.flatMap((outcome) =>
        "reply" in outcome ? [{ businessName: outcome.businessName, reply: outcome.reply }] : [],
      ),
      unreachable: outcomes.flatMap((outcome) =>
        "unreachable" in outcome ? [outcome.unreachable] : [],
      ),
    });
  }

  async function runFallbackPath(): Promise<void> {
    const routableBusinesses: RoutableBusiness[] = businesses.map(
      ({ customerId, name, keywords }) => ({ customerId, name, keywords }),
    );
    const awaitingThreads = orderedAwaitingThreads(conversation, connection.customerIds);
    const routes = routeMessage({
      text,
      businesses: routableBusinesses,
      awaitingCustomerIds: awaitingThreads.map((thread) => thread.customerId),
    });
    const targets = routes.flatMap((customerId) => {
      const business = businesses.find((candidate) => candidate.customerId === customerId);
      return business ? [business] : [];
    });
    await Promise.all(
      targets.map(async (business) => {
        try {
          await sendToBusiness(business.customerId, text);
        } catch {
          return;
        }
      }),
    );
    normalizeParallelReplyTimestamps(
      conversation,
      outcomes.flatMap((outcome) => ("reply" in outcome ? [outcome.customerId] : [])),
      nextTimestamp,
    );
  }

  let replyText: string;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await runFallbackPath();
    replyText = composeOutcomes();
  } else {
    try {
      replyText = await runPersonalAgent({
        text,
        transcript,
        threads: conversation.threads,
        businesses: businesses.map(({ customerId, name, description, skills }) => ({
          customerId,
          name,
          description,
          skills,
        })),
        profile: DEMO_USER_PROFILE,
        apiKey,
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
        sendToBusiness,
        onUpdate: appendPhoneMessage,
      });
    } catch {
      if (outcomes.length === 0) await runFallbackPath();
      replyText = composeOutcomes();
    }
  }

  const message: PhoneMessage = {
    role: "personal-agent",
    text: replyText,
    at: nextTimestamp(),
  };
  conversation.messages.push(message);
  conversation.updatedAt = message.at;
  emit({ type: "reply", message });
  await saveConversation(conversation);
  emit({
    type: "done",
    href: homePath({ ...connection, conversationId: conversation.id }),
  });
}
