import type { ReactElement } from "react";
import type { BusinessThread } from "../lib/conversationStore.js";

export function ThreadCard(input: {
  thread: BusinessThread;
  color: string;
  typing?: boolean;
  error?: string;
}): ReactElement {
  const { thread } = input;
  const needsSignIn = thread.messages.at(-1)?.authRequired !== undefined;
  return (
    <article className="thread-card">
      <header style={{ background: input.color }}>
        <span className="brand-avatar light" aria-hidden>
          {thread.businessName.charAt(0)}
        </span>
        <div>
          <h3>{thread.businessName}</h3>
          <p>
            contextId <code>{thread.contextId.slice(0, 8)}</code>
          </p>
        </div>
      </header>
      <div className="thread-card-body">
        {thread.messages.map((message, index) => (
          <div className="tmessage" key={`${message.at}-${index}`}>
            <p
              className={message.role === "ROLE_USER" ? "tbubble from-pa" : "tbubble from-business"}
            >
              {message.text}
            </p>
            {message.authRequired ? (
              <span className="tmeta auth">Auth required · {message.authRequired.join(", ")}</span>
            ) : null}
            {message.receipt ? (
              <span
                className={message.receipt.verified ? "tmeta receipt" : "tmeta auth"}
                title={`grant ${message.receipt.grantId}`}
              >
                {message.receipt.verified ? "Signed receipt ✓" : "Receipt not verified"}
                {message.receipt.actions.length > 0
                  ? ` · ${message.receipt.actions.join(", ")}`
                  : ""}
                {message.receipt.scopesUsed.length > 0
                  ? ` · ${message.receipt.scopesUsed.join(", ")}`
                  : ""}
              </span>
            ) : null}
          </div>
        ))}
        {input.error ? <p className="tbubble from-business">{input.error}</p> : null}
        {input.typing ? (
          <p
            className="tbubble from-business typing"
            aria-label={`${thread.businessName} is typing`}
          >
            <i />
            <i />
            <i />
          </p>
        ) : null}
        {!input.typing && !input.error ? (
          <span
            className={
              thread.awaitingReply || needsSignIn ? "thread-status waiting" : "thread-status done"
            }
          >
            {needsSignIn ? "Waiting for sign-in" : thread.awaitingReply ? "Waiting" : "Answered"}
          </span>
        ) : null}
      </div>
    </article>
  );
}
