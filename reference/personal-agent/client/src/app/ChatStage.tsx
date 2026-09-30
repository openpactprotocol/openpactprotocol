"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Sparkle, Video, Wifi } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState, type ReactElement } from "react";
import { brandColor } from "../lib/brand.js";
import type { BusinessThread, PhoneMessage } from "../lib/conversationStore.js";
import { homePath } from "../lib/session.js";
import type { TurnEvent } from "../lib/turnEvents.js";
import { PhoneChat } from "./PhoneChat.js";
import { ThreadCard } from "./ThreadCard.js";

type LiveOverlay = {
  base: PhoneMessage[];
  text: string;
  messages: PhoneMessage[];
  threads: BusinessThread[];
  typing: boolean;
  busy: boolean;
  typingCustomerIds: string[];
  businessErrors: Record<string, string>;
};

export function ChatStage(input: {
  messages: PhoneMessage[];
  threads: BusinessThread[];
  dayLabel: string;
  providerUrl: string;
  customerIds: string[];
  conversationId: string;
  connected: boolean;
}): ReactElement {
  const router = useRouter();
  const [live, setLive] = useState<LiveOverlay | null>(null);
  const overlay = live?.base === input.messages ? live : undefined;
  const messages = overlay?.messages ?? input.messages;
  const threads = overlay?.threads ?? input.threads;
  const typingCustomerIds = new Set(overlay?.typingCustomerIds ?? []);

  function updateLive(update: (current: LiveOverlay) => LiveOverlay): void {
    setLive((current) => (current?.base === input.messages ? update(current) : current));
  }

  function showError(message: string): void {
    updateLive((current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          role: "personal-agent",
          text: `Something went wrong: ${message}`,
          at: new Date().toISOString(),
        },
      ],
      typing: false,
      busy: false,
      typingCustomerIds: [],
    }));
    startTransition(() => router.refresh());
  }

  async function send(text: string): Promise<void> {
    setLive({
      base: input.messages,
      text,
      messages: [...input.messages, { role: "user", text, at: new Date().toISOString() }],
      threads: input.threads,
      typing: true,
      busy: true,
      typingCustomerIds: [],
      businessErrors: {},
    });

    function handleEvent(event: TurnEvent): boolean {
      switch (event.type) {
        case "business-start":
          updateLive((current) => {
            const nextThreads = [...current.threads];
            const at = new Date().toISOString();
            const index = nextThreads.findIndex((thread) => thread.customerId === event.customerId);
            const thread =
              index < 0
                ? {
                    customerId: event.customerId,
                    businessName: event.businessName,
                    contextId: "…",
                    messages: [],
                    awaitingReply: false,
                  }
                : nextThreads[index]!;
            const outgoingThread: BusinessThread = {
              ...thread,
              businessName: event.businessName,
              messages: [...thread.messages, { role: "ROLE_USER", text: event.text, at }],
              awaitingReply: false,
            };
            if (index < 0) nextThreads.push(outgoingThread);
            else nextThreads[index] = outgoingThread;
            const businessErrors = { ...current.businessErrors };
            delete businessErrors[event.customerId];
            return {
              ...current,
              threads: nextThreads,
              typingCustomerIds: current.typingCustomerIds.includes(event.customerId)
                ? current.typingCustomerIds
                : [...current.typingCustomerIds, event.customerId],
              businessErrors,
            };
          });
          return true;
        case "business":
          updateLive((current) => {
            const index = current.threads.findIndex(
              (thread) => thread.customerId === event.thread.customerId,
            );
            const nextThreads = [...current.threads];
            if (index < 0) nextThreads.push(event.thread);
            else nextThreads[index] = event.thread;
            const businessErrors = { ...current.businessErrors };
            delete businessErrors[event.thread.customerId];
            return {
              ...current,
              threads: nextThreads,
              typingCustomerIds: current.typingCustomerIds.filter(
                (customerId) => customerId !== event.thread.customerId,
              ),
              businessErrors,
            };
          });
          return true;
        case "business-error":
          updateLive((current) => ({
            ...current,
            typingCustomerIds: current.typingCustomerIds.filter(
              (customerId) => customerId !== event.customerId,
            ),
            businessErrors: {
              ...current.businessErrors,
              [event.customerId]: `Couldn't reach ${event.businessName}: ${event.message}`,
            },
          }));
          return true;
        case "reply":
          updateLive((current) => ({
            ...current,
            messages: [...current.messages, event.message],
          }));
          return true;
        case "done":
          updateLive((current) => ({ ...current, typing: false, busy: false }));
          startTransition(() => router.replace(event.href));
          return true;
        case "error":
          showError(event.message);
          return false;
      }
    }

    try {
      const response = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerUrl: input.providerUrl,
          customerIds: input.customerIds,
          conversationId: input.conversationId,
          text,
        }),
      });
      if (!response.ok) {
        throw new Error(`Turn request failed with HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Turn response has no stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedDone = false;
      let receivedError = false;

      function handleLine(line: string): void {
        if (!line.trim()) return;
        const event = JSON.parse(line) as TurnEvent;
        if (event.type === "done") receivedDone = true;
        if (event.type === "error") receivedError = true;
        if (!handleEvent(event)) receivedError = true;
      }

      try {
        while (true) {
          const result = await reader.read();
          buffer += decoder.decode(result.value, { stream: !result.done });
          let lineEnd = buffer.indexOf("\n");
          while (lineEnd >= 0) {
            handleLine(buffer.slice(0, lineEnd));
            buffer = buffer.slice(lineEnd + 1);
            lineEnd = buffer.indexOf("\n");
          }
          if (result.done) break;
        }
        if (buffer.trim()) handleLine(buffer);
      } finally {
        reader.releaseLock();
      }
      if (!receivedDone && !receivedError) {
        throw new Error("Turn stream ended before completion");
      }
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : "Turn failed");
    }
  }

  return (
    <section className="stage" aria-label="Chat">
      <div className="phone">
        <span className="side-button action" aria-hidden />
        <span className="side-button volume-up" aria-hidden />
        <span className="side-button volume-down" aria-hidden />
        <span className="side-button power" aria-hidden />
        <div className="screen">
          <div className="status-bar" aria-hidden>
            <span className="clock">9:41</span>
            <span className="island" />
            <span className="status-icons">
              <span className="signal">
                <i />
                <i />
                <i />
                <i />
              </span>
              <Wifi size={17} strokeWidth={2.75} />
              <span className="battery">
                <span>73</span>
              </span>
            </span>
          </div>

          <header className="contact">
            <Link
              className="round-button"
              href={homePath({ providerUrl: input.providerUrl, customerIds: input.customerIds })}
              aria-label="New conversation"
              title="New conversation"
            >
              <ChevronLeft size={20} aria-hidden />
            </Link>
            <div className="contact-center">
              <span className="contact-avatar" aria-hidden>
                <Sparkle size={24} fill="currentColor" strokeWidth={1.5} />
              </span>
              <span className="contact-name">
                Personal Agent
                <ChevronRight size={14} aria-hidden />
              </span>
            </div>
            <span className="round-button" aria-hidden>
              <Video size={20} strokeWidth={1.75} />
            </span>
          </header>

          <PhoneChat
            messages={messages}
            typing={overlay?.typing ?? false}
            dayLabel={input.dayLabel}
            connected={input.connected}
            busy={overlay?.busy ?? false}
            onSend={(text) => void send(text)}
          />
          <span className="home-indicator" aria-hidden />
        </div>
      </div>

      <div className="threads" aria-label="Business conversations">
        {threads.map((thread) => (
          <ThreadCard
            key={thread.customerId}
            thread={thread}
            color={brandColor(input.customerIds, thread.customerId)}
            typing={typingCustomerIds.has(thread.customerId)}
            error={overlay?.businessErrors[thread.customerId] ?? ""}
          />
        ))}
      </div>
    </section>
  );
}
