import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReactElement } from "react";
import type { BusinessThread, ReceiptSummary } from "../lib/conversationStore.js";

function toolLabel(tool: string): string {
  const words = tool.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ReceiptView(input: {
  receipt: ReceiptSummary;
  scopeLabel: (scope: string) => string;
}): ReactElement {
  const { receipt } = input;
  return (
    <details className={receipt.verified ? "treceipt" : "treceipt unverified"}>
      <summary>
        {receipt.verified ? (
          <ShieldCheck size={13} aria-hidden />
        ) : (
          <ShieldAlert size={13} aria-hidden />
        )}
        {receipt.verified ? "Verified receipt" : "Receipt not verified"}
      </summary>
      <dl>
        {receipt.actions.length > 0 ? (
          <>
            <dt>Actions</dt>
            <dd>{receipt.actions.map(toolLabel).join(", ")}</dd>
          </>
        ) : null}
        {receipt.scopesUsed.length > 0 ? (
          <>
            <dt>Access used</dt>
            <dd>{receipt.scopesUsed.map(input.scopeLabel).join(", ")}</dd>
          </>
        ) : null}
        <dt>Grant</dt>
        <dd>
          <code>{receipt.grantId}</code>
        </dd>
      </dl>
    </details>
  );
}

export function ThreadCard(input: {
  thread: BusinessThread;
  color: string;
  typing?: boolean;
  error?: string;
}): ReactElement {
  const { thread } = input;
  const needsSignIn = thread.messages.at(-1)?.authRequired !== undefined;
  const scopeLabel = (scope: string) => thread.scopeLabels?.[scope] ?? scope;
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
        {thread.messages.map((message, index) => {
          const resent =
            message.role === "ROLE_USER" && thread.messages[index - 1]?.authRequired !== undefined;
          return (
            <div className="tmessage" key={`${message.at}-${index}`}>
              {resent ? <span className="tnote">Resent after sign-in</span> : null}
              <p
                className={
                  message.role === "ROLE_USER" ? "tbubble from-pa" : "tbubble from-business"
                }
              >
                {message.text}
              </p>
              {message.receipt ? (
                <ReceiptView receipt={message.receipt} scopeLabel={scopeLabel} />
              ) : null}
              {message.authRequired ? (
                <span className="tevent">
                  <KeyRound size={12} aria-hidden />
                  Sign-in requested · {message.authRequired.map(scopeLabel).join(", ")}
                </span>
              ) : null}
            </div>
          );
        })}
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
