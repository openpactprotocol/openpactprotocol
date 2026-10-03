"use client";

import { ArrowUp, AudioLines, Check, ExternalLink, Plus } from "lucide-react";
import { useRef, type FormEvent, type ReactElement } from "react";
import type { PhoneMessage, SignInCard } from "../lib/conversationStore.js";

function SignInCardView({ card }: { card: SignInCard }): ReactElement {
  const logo = (
    <span className="signin-logo" aria-hidden>
      {card.businessName.charAt(0)}
    </span>
  );
  if (card.status === "pending") {
    // Opens in a new tab: the personal agent must not frame or observe the login.
    return (
      <a className="signin-card pending" href={card.url} target="_blank" rel="noopener noreferrer">
        <span className="signin-row">
          {logo}
          <span className="signin-text">
            <strong>{card.businessName}</strong>
            <small>Choose what I can access</small>
          </span>
        </span>
        <span className="signin-button">
          Sign in
          <ExternalLink size={14} aria-hidden />
        </span>
      </a>
    );
  }
  const granted = card.grantedScopes ?? [];
  const labels = granted.map((scope) => card.scopeLabels?.[scope] ?? scope);
  return (
    <div className={`signin-card ${card.status}`}>
      <span className="signin-row">
        {logo}
        <span className="signin-text">
          {card.status === "connected" ? (
            <>
              <strong className="signin-connected">
                <span className="signin-check" aria-hidden>
                  <Check size={11} strokeWidth={3.5} />
                </span>
                Connected
              </strong>
              <small title={labels.join(", ")}>
                {card.businessName} · {granted.length}{" "}
                {granted.length === 1 ? "permission" : "permissions"}
              </small>
            </>
          ) : (
            <>
              <strong>{card.businessName}</strong>
              <small>{card.status === "denied" ? "Not connected" : "Sign-in link expired"}</small>
            </>
          )}
        </span>
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
