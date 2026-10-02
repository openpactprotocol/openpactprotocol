"use client";

import { ArrowUp, AudioLines, Check, ExternalLink, Plus } from "lucide-react";
import { useRef, type FormEvent, type ReactElement } from "react";
import type { PhoneMessage, SignInCard } from "../lib/conversationStore.js";

function SignInCardView({ card }: { card: SignInCard }): ReactElement {
  const host = (() => {
    try {
      return new URL(card.url).host;
    } catch {
      return card.url;
    }
  })();
  const head = (
    <span className="signin-head">
      <span className="signin-logo" aria-hidden>
        {card.businessName.charAt(0)}
      </span>
      <span>
        <strong>Sign in with {card.businessName}</strong>
        <small>{host} · Personal Agent</small>
      </span>
    </span>
  );
  if (card.status === "pending") {
    // Opens in a new tab: the personal agent must not frame or observe the login.
    return (
      <a className="signin-card" href={card.url} target="_blank" rel="noopener noreferrer">
        {head}
        <span className="signin-foot">
          Continue in {card.businessName}
          <ExternalLink size={14} aria-hidden />
        </span>
      </a>
    );
  }
  const granted = card.grantedScopes ?? [];
  return (
    <div className={`signin-card ${card.status}`}>
      {head}
      <span className="signin-foot">
        {card.status === "connected" ? (
          <>
            <Check size={14} aria-hidden />
            Connected · {granted.length} {granted.length === 1 ? "permission" : "permissions"}
          </>
        ) : card.status === "denied" ? (
          "Not connected"
        ) : (
          "Sign-in link expired"
        )}
      </span>
    </div>
  );
}

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
              {message.role === "personal-agent" && message.signIn ? (
                <SignInCardView card={message.signIn} />
              ) : null}
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
