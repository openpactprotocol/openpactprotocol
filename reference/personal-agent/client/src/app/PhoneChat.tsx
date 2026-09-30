"use client";

import { ArrowUp, AudioLines, Plus } from "lucide-react";
import { useRef, type FormEvent, type ReactElement } from "react";
import type { PhoneMessage } from "../lib/conversationStore.js";

export function PhoneChat(input: {
  messages: PhoneMessage[];
  typing: boolean;
  dayLabel: string;
  connected: boolean;
  busy: boolean;
  onSend: (text: string) => void;
}): ReactElement {
  const textInput = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = textInput.current?.value.trim() ?? "";
    if (!text) return;
    if (textInput.current) textInput.current.value = "";
    input.onSend(text);
  }

  return (
    <>
      <div className="thread">
        <div className="thread-inner">
          <p className="timestamp">{input.dayLabel}</p>
          {input.messages.map((message, index) => (
            <div
              className={message.role === "user" ? "row outgoing" : "row incoming"}
              key={`${message.at}-${index}`}
            >
              <p className="bubble">{message.text}</p>
            </div>
          ))}
          {input.typing ? (
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

      <form className="composer" onSubmit={submit}>
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
            disabled={!input.connected || input.busy}
          />
          <span className="dictate" aria-hidden>
            <AudioLines size={18} strokeWidth={1.75} />
          </span>
          <button
            type="submit"
            className="send"
            disabled={!input.connected || input.busy}
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
