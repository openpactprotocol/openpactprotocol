import type { ReactElement } from "react";
import type { BusinessThread } from "../lib/conversationStore.js";

export function ThreadCard(input: {
  thread: BusinessThread;
  color: string;
  typing?: boolean;
  error?: string;
}): ReactElement {
  const { thread } = input;
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
          <p
            className={message.role === "ROLE_USER" ? "tbubble from-pa" : "tbubble from-business"}
            key={`${message.at}-${index}`}
          >
            {message.text}
          </p>
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
          <span className={thread.awaitingReply ? "thread-status waiting" : "thread-status done"}>
            {thread.awaitingReply ? "Waiting" : "Answered"}
          </span>
        ) : null}
      </div>
    </article>
  );
}
