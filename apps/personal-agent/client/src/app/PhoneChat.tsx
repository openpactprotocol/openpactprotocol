"use client";

import { ArrowUp, AudioLines, Plus } from "lucide-react";
import { useOptimistic, useRef, type ReactElement } from "react";
import type { PhoneMessage } from "../lib/conversationStore.js";
import { sendChatMessage } from "./actions.js";

export function PhoneChat(input: {
  messages: PhoneMessage[];
  dayLabel: string;
  providerUrl: string;
  customerIds: string[];
  conversationId: string;
  connected: boolean;
}): ReactElement {
  const [pendingText, setPendingText] = useOptimistic<string | undefined, string>(
    undefined,
    (_, text) => text,
  );
  const textInput = useRef<HTMLInputElement>(null);

  async function send(formData: FormData): Promise<void> {
    const text = String(formData.get("text") ?? "").trim();
    if (!text) return;
    setPendingText(text);
    if (textInput.current) textInput.current.value = "";
    await sendChatMessage(formData);
  }

  const messages: PhoneMessage[] = pendingText
    ? [...input.messages, { role: "user", text: pendingText, at: "" }]
    : input.messages;

  return (
    <>
      <div className="thread">
        <div className="thread-inner">
          <p className="timestamp">{input.dayLabel}</p>
          {messages.map((message, index) => {
            const previousMessage = messages[index - 1];
            const showSender =
              message.role !== "user" &&
              (previousMessage?.role !== message.role ||
                (message.role === "business" &&
                  previousMessage?.role === "business" &&
                  previousMessage.businessName !== message.businessName));
            return (
              <div
                className={message.role === "user" ? "row outgoing" : "row incoming"}
                key={`${message.at}-${index}`}
              >
                {showSender ? (
                  <span className="sender">
                    {message.role === "business" ? message.businessName : "Personal Agent"}
                  </span>
                ) : null}
                <p className="bubble">{message.text}</p>
              </div>
            );
          })}
          {pendingText ? (
            <div className="row incoming" aria-label="Personal Agent is typing">
              <p className="bubble typing" aria-hidden>
                <i />
                <i />
                <i />
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <form className="composer" action={send}>
        <input name="providerUrl" type="hidden" value={input.providerUrl} />
        <input name="customerIds" type="hidden" value={input.customerIds.join(",")} />
        <input name="conversationId" type="hidden" value={input.conversationId} />
        <span className="composer-plus" aria-hidden>
          <Plus size={20} strokeWidth={1.75} />
        </span>
        <div className="composer-pill">
          <input
            ref={textInput}
            name="text"
            required
            autoComplete="off"
            placeholder={input.connected ? "Message" : "Not connected"}
            aria-label="Message"
            disabled={!input.connected}
          />
          <span className="dictate" aria-hidden>
            <AudioLines size={18} strokeWidth={1.75} />
          </span>
          <button
            type="submit"
            className="send"
            disabled={!input.connected}
            aria-label="Send"
            title="Send"
          >
            <ArrowUp size={16} strokeWidth={3} aria-hidden />
          </button>
        </div>
      </form>
    </>
  );
}
