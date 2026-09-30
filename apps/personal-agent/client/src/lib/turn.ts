import { randomUUID } from "node:crypto";
import { A2AClient, createPlatformSigner, discoverAgent } from "@pac2/client";
import { composeFallbackReply } from "./composer.js";
import {
  getConversation,
  saveConversation,
  type BusinessThread,
  type PaConversation,
  type PhoneMessage,
} from "./conversationStore.js";
import { composeWithOpenAI } from "./llmComposer.js";
import { homePath } from "./session.js";
import { routeWithOpenAI } from "./llmRouter.js";
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
  | { customerId: string; unreachable: string };

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

export async function runTurn(
  input: {
    connection: Connection;
    text: string;
    conversationId: string;
    userId: string;
    issuer: string;
    privateJwk: string;
  },
  emit: (event: TurnEvent) => void,
): Promise<void> {
  const { connection, text } = input;
  let conversation = input.conversationId
    ? await getConversation({
        userId: input.userId,
        providerUrl: connection.providerUrl,
        id: input.conversationId,
      })
    : undefined;
  if (!conversation) {
    conversation = createConversation({
      userId: input.userId,
      providerUrl: connection.providerUrl,
    });
  }
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
  const routableBusinesses: RoutableBusiness[] = businesses.map(
    ({ customerId, name, keywords }) => ({ customerId, name, keywords }),
  );
  const awaitingThreads = orderedAwaitingThreads(conversation, connection.customerIds);
  const awaitingCustomerIds = awaitingThreads.map((thread) => thread.customerId);
  const fallbackRoute = () =>
    routeMessage({ text, businesses: routableBusinesses, awaitingCustomerIds });
  const apiKey = process.env.OPENAI_API_KEY;
  let routes: string[];
  if (apiKey && businesses.length > 0) {
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
        apiKey,
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
      });
    } catch {
      routes = fallbackRoute();
    }
  } else {
    routes = fallbackRoute();
  }

  const targets = routes.flatMap((customerId) => {
    const business = businesses.find((candidate) => candidate.customerId === customerId);
    return business ? [business] : [];
  });
  emit({
    type: "routed",
    conversationId: conversation.id,
    targets: targets.map(({ customerId, name }) => ({ customerId, businessName: name })),
  });

  const nextTimestamp = createTimestampGenerator(conversation.updatedAt);
  const transcript = transcriptMessages(conversation.messages);
  const userAt = nextTimestamp();
  conversation.messages.push({ role: "user", text, at: userAt });
  if (targets.length === 0) {
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

  const signer = createPlatformSigner({ issuer: input.issuer, privateJwk: input.privateJwk });
  const outcomes: BusinessOutcome[] = await Promise.all(
    targets.map(async (business): Promise<BusinessOutcome> => {
      const thread = conversation.threads.find(
        (candidate) => candidate.customerId === business.customerId,
      );
      try {
        const client = new A2AClient({
          url: business.url,
          signer,
          userId: input.userId,
          ...(process.env.PA_AUDIENCE ? { audience: process.env.PA_AUDIENCE } : {}),
        });
        const response = await client.sendMessage(
          text,
          thread ? { contextId: thread.contextId } : {},
        );
        if (!response.contextId) throw new Error("Agent response is missing contextId");
        const reply = response.parts.map((part) => ("text" in part ? part.text : "")).join("\n");
        const replyAt = nextTimestamp();
        const existingIndex = conversation.threads.findIndex(
          (candidate) => candidate.customerId === business.customerId,
        );
        const previousThread = existingIndex < 0 ? undefined : conversation.threads[existingIndex];
        const updatedThread: BusinessThread = {
          customerId: business.customerId,
          businessName: business.name,
          contextId: response.contextId,
          messages: [
            ...(previousThread?.messages ?? []),
            { role: "ROLE_USER", text, at: userAt },
            { role: "ROLE_AGENT", text: reply, at: replyAt },
          ],
          awaitingReply: reply.trimEnd().endsWith("?"),
        };
        if (existingIndex < 0) conversation.threads.push(updatedThread);
        else conversation.threads[existingIndex] = updatedThread;
        conversation.updatedAt = replyAt;
        emit({ type: "business", thread: updatedThread });
        return {
          customerId: business.customerId,
          businessName: business.name,
          reply,
          waitingOnUser: reply.trimEnd().endsWith("?"),
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Request failed";
        emit({
          type: "business-error",
          customerId: business.customerId,
          businessName: business.name,
          message,
        });
        return { customerId: business.customerId, unreachable: business.name };
      }
    }),
  );
  const repliedCustomerIds = new Set(
    outcomes.flatMap((outcome) => ("reply" in outcome ? [outcome.customerId] : [])),
  );
  if (repliedCustomerIds.size > 0) {
    const threadReplyAt = nextTimestamp();
    for (const thread of conversation.threads) {
      if (!repliedCustomerIds.has(thread.customerId)) continue;
      let lastAgentIndex = -1;
      for (let index = 0; index < thread.messages.length; index += 1) {
        if (thread.messages[index]?.role === "ROLE_AGENT") lastAgentIndex = index;
      }
      const lastAgentMessage = thread.messages[lastAgentIndex];
      if (lastAgentMessage) {
        thread.messages[lastAgentIndex] = { ...lastAgentMessage, at: threadReplyAt };
      }
    }
    conversation.updatedAt = threadReplyAt;
  }
  const replies = outcomes.flatMap((outcome) =>
    "reply" in outcome
      ? [
          {
            customerId: outcome.customerId,
            businessName: outcome.businessName,
            reply: outcome.reply,
            waitingOnUser: outcome.waitingOnUser,
          },
        ]
      : [],
  );
  const unreachable = outcomes.flatMap((outcome) =>
    "unreachable" in outcome ? [outcome.unreachable] : [],
  );

  let replyText: string;
  const composerApiKey = process.env.OPENAI_API_KEY;
  if (composerApiKey) {
    try {
      replyText = await composeWithOpenAI({
        text,
        transcript,
        replies: replies.map(({ businessName, reply, waitingOnUser }) => ({
          businessName,
          reply,
          waitingOnUser,
        })),
        unreachable,
        apiKey: composerApiKey,
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
      });
    } catch {
      replyText = composeFallbackReply({
        replies: replies.map(({ businessName, reply }) => ({ businessName, reply })),
        unreachable,
      });
    }
  } else {
    replyText = composeFallbackReply({
      replies: replies.map(({ businessName, reply }) => ({ businessName, reply })),
      unreachable,
    });
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
