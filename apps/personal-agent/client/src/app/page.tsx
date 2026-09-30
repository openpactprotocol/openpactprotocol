import Link from "next/link";
import { A2AHttpError, discoverAgent } from "@pac2/client";
import type { AgentCard } from "@pac2/protocol";
import {
  Bot,
  CircleAlert,
  CircleCheck,
  CircleX,
  Headset,
  Fingerprint,
  KeyRound,
  Link as LinkIcon,
  Lock,
  MessageCircle,
  MessagesSquare,
  Plug,
  RotateCw,
  SendHorizontal,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { cookies } from "next/headers";
import type { ReactElement } from "react";
import {
  defaultPlatformName,
  homePath,
  readRegistrationNotice,
  USER_ID_COOKIE,
  type RegistrationNotice,
} from "../lib/session.js";
import {
  listConversations,
  type StoredConversation,
  type StoredConversationMessage,
} from "../lib/conversationStore.js";
import { connect, newUser, registerPersonalAgent, sendChatMessage } from "./actions.js";

export const dynamic = "force-dynamic";

function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function authLabel(card: AgentCard): string | undefined {
  for (const scheme of Object.values(card.securitySchemes ?? {})) {
    if ("httpAuthSecurityScheme" in scheme) {
      const http = scheme.httpAuthSecurityScheme;
      return [http.scheme, http.bearerFormat].filter(Boolean).join(" ");
    }
  }
  return undefined;
}

function RegistrationResult({ notice }: { notice: RegistrationNotice }): ReactElement {
  if (notice.status === "error") {
    return (
      <p className="notice error" role="alert">
        <CircleX size={16} aria-hidden />
        Registration of <code>{notice.name}</code> failed: {notice.message}
      </p>
    );
  }
  return (
    <p className="notice success">
      <CircleCheck size={16} aria-hidden />
      {notice.status === "created" ? (
        <span>
          Registered <code>{notice.name}</code> with the provider. It is enabled and can call
          customer agents now.
        </span>
      ) : (
        <span>
          <code>{notice.name}</code> is already registered with the provider.
        </span>
      )}
    </p>
  );
}

function RegisterPanel(input: {
  providerUrl: string;
  customerId: string;
  issuer: string;
  open: boolean;
  notice: RegistrationNotice | undefined;
}): ReactElement {
  const provider = input.providerUrl.replace(/\/+$/, "");
  const jwksUri = `${input.issuer}/.well-known/jwks.json`;
  return (
    <details className="card register" open={input.open}>
      <summary>
        <KeyRound size={16} aria-hidden />
        <span>Register personal agent</span>
        <span className="summary-hint">One-time onboarding of this platform with the provider</span>
      </summary>
      <div className="register-body">
        <ol className="steps">
          <li>
            <strong>Publish public keys</strong>
            <span>
              The platform hosts its JWKS on its own origin:{" "}
              <a href={jwksUri} target="_blank" rel="noreferrer">
                <code>{jwksUri}</code>
              </a>
            </span>
          </li>
          <li>
            <strong>Sign a registration assertion</strong>
            <span>
              An ES256 JWT, valid for at most five minutes. The private key never leaves this
              client.
            </span>
            <dl className="claims">
              <dt>iss, sub</dt>
              <dd>{input.issuer}</dd>
              <dt>aud</dt>
              <dd>{provider}/api/platforms</dd>
            </dl>
          </li>
          <li>
            <strong>
              POST <code>/api/platforms</code>
            </strong>
            <span>
              The provider verifies the assertion against the JWKS and stores the platform&apos;s
              name, issuer and JWKS URI. Later A2A calls are verified against the same keys.
            </span>
          </li>
        </ol>
        <form className="register-form" action={registerPersonalAgent}>
          <input name="providerUrl" type="hidden" value={input.providerUrl} />
          <input name="customerId" type="hidden" value={input.customerId} />
          <label>
            <span>Platform name</span>
            <input value={defaultPlatformName()} readOnly />
          </label>
          <label>
            <span>Issuer</span>
            <input value={input.issuer} readOnly />
          </label>
          <button type="submit" className="primary">
            <KeyRound size={16} aria-hidden />
            Register personal agent
          </button>
        </form>
        {input.notice ? <RegistrationResult notice={input.notice} /> : null}
      </div>
    </details>
  );
}

function signingKeyId(privateJwk: string): string | undefined {
  try {
    const jwk: unknown = JSON.parse(privateJwk);
    if (typeof jwk === "object" && jwk !== null && "kid" in jwk && typeof jwk.kid === "string") {
      return jwk.kid;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function PlatformIdentity(input: { issuer: string; privateJwk: string }): ReactElement {
  const kid = signingKeyId(input.privateJwk);
  return (
    <div className="identity" title="Every A2A call from this client is signed as this platform">
      <span className="identity-label">
        <Fingerprint size={14} aria-hidden />
        Signing as
      </span>
      <span className="identity-name">{defaultPlatformName()}</span>
      <code>{input.issuer}</code>
      {kid ? <code title={kid}>kid {kid.slice(0, 8)}…</code> : null}
    </div>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    providerUrl?: string;
    customerId?: string;
    context?: string;
    registration?: string;
    platformName?: string;
    registrationError?: string;
  }>;
}): Promise<ReactElement> {
  const query = await searchParams;
  const providerUrl = query.providerUrl ?? process.env.PROVIDER_URL ?? "http://localhost:3000";
  const customerId = query.customerId ?? process.env.CUSTOMER_ID ?? "";
  const userId = (await cookies()).get(USER_ID_COOKIE)?.value ?? "";
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  let card: AgentCard | undefined;
  let conversations: StoredConversation[] = [];
  let selectedConversation: StoredConversation | undefined;
  let error: string | undefined;
  let unauthorized = false;
  const registration = readRegistrationNotice(query);
  if (customerId && userId) {
    conversations = await listConversations({ userId, providerUrl, customerId });
    selectedConversation = conversations.find(
      (conversation) => conversation.contextId === query.context,
    );
  }
  if (customerId && issuer && privateJwk) {
    try {
      const discovery = await discoverAgent(providerUrl, customerId);
      card = discovery.card;
    } catch (cause) {
      unauthorized = cause instanceof A2AHttpError && cause.status === 401;
      error = unauthorized
        ? "The provider rejected this platform's token (401). Is this personal agent registered with the provider?"
        : cause instanceof Error
          ? cause.message
          : "Could not connect to the provider.";
    }
  }
  const messages: StoredConversationMessage[] = selectedConversation?.messages ?? [];
  const agentInterface = card?.supportedInterfaces[0];
  const auth = card ? authLabel(card) : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <Bot size={18} />
          </span>
          <div>
            <h1>PAC2</h1>
            <p>Personal Agent Customer Connector · local client</p>
          </div>
          {issuer && privateJwk ? (
            <PlatformIdentity issuer={issuer} privateJwk={privateJwk} />
          ) : null}
        </div>
      </header>

      <main>
        <form className="card connect" action={connect}>
          <label>
            <span>Provider URL</span>
            <input name="providerUrl" defaultValue={providerUrl} />
          </label>
          <label>
            <span>Customer ID</span>
            <input name="customerId" defaultValue={customerId} placeholder="01J..." />
          </label>
          <label className="user-field">
            <span>User ID</span>
            <div className="input-group">
              <input name="userId" defaultValue={userId} spellCheck={false} />
              <button
                type="submit"
                formAction={newUser}
                className="secondary icon-button"
                title="Generate a new user ID"
                aria-label="Generate a new user ID"
              >
                <RotateCw size={16} aria-hidden />
              </button>
            </div>
          </label>
          <button type="submit" className="primary">
            <Plug size={16} aria-hidden />
            Connect
          </button>
        </form>

        {!issuer || !privateJwk ? (
          <p className="alert">
            <CircleAlert size={16} aria-hidden />
            Configure PA_ISSUER and PA_PRIVATE_JWK in the server environment.
          </p>
        ) : null}
        {error ? (
          <p className="alert" role="alert">
            <CircleAlert size={16} aria-hidden />
            {error}
          </p>
        ) : null}

        {issuer && privateJwk ? (
          <RegisterPanel
            providerUrl={providerUrl}
            customerId={customerId}
            issuer={issuer}
            open={unauthorized || registration !== undefined}
            notice={registration}
          />
        ) : null}

        <div className="workspace">
          <aside className="card sidebar">
            <div className="sidebar-head">
              <h2>Conversations</h2>
              <Link className="button secondary small" href={homePath({ providerUrl, customerId })}>
                <SquarePen size={14} aria-hidden />
                New chat
              </Link>
            </div>
            {conversations.length === 0 ? (
              <div className="empty">
                <MessagesSquare size={20} aria-hidden />
                No conversations yet.
              </div>
            ) : (
              <ul className="conversation-list">
                {conversations.map((conversation) => (
                  <li key={conversation.contextId}>
                    <Link
                      href={homePath({
                        providerUrl,
                        customerId,
                        contextId: conversation.contextId,
                      })}
                      className={
                        conversation.contextId === selectedConversation?.contextId
                          ? "conversation-link active"
                          : "conversation-link"
                      }
                    >
                      <span className="preview">
                        {conversation.messages.find((message) => message.role === "ROLE_USER")
                          ?.text ?? "Untitled conversation"}
                      </span>
                      <span className="conversation-meta">
                        <span>{formatTime(conversation.updatedAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="card chat">
            {card ? (
              <header className="agent">
                <span className="avatar" aria-hidden>
                  <Headset size={20} />
                </span>
                <div className="agent-body">
                  <h2>{card.name}</h2>
                  <p>{card.description}</p>
                  <div className="chips">
                    {card.skills.map((skill) => (
                      <span className="chip" key={skill.id} title={skill.description}>
                        <Sparkles size={12} aria-hidden />
                        {skill.name}
                      </span>
                    ))}
                    {auth ? (
                      <span className="chip muted">
                        <Lock size={12} aria-hidden />
                        {auth}
                      </span>
                    ) : null}
                    {agentInterface ? (
                      <span className="chip muted">
                        <LinkIcon size={12} aria-hidden />
                        {agentInterface.protocolBinding} {agentInterface.protocolVersion}
                      </span>
                    ) : null}
                  </div>
                </div>
              </header>
            ) : (
              <header className="agent">
                <div className="agent-body">
                  <h2>Not connected</h2>
                  <p>Enter a provider URL and customer ID, then connect.</p>
                </div>
              </header>
            )}

            <div className="thread-head">
              <h3>
                {selectedConversation
                  ? `Conversation ${selectedConversation.contextId.slice(0, 8)}`
                  : "New conversation"}
              </h3>
            </div>

            <div className="thread">
              {messages.length === 0 ? (
                <div className="empty">
                  <MessageCircle size={28} aria-hidden />
                  Ask about hours, location, parking, or insurance.
                </div>
              ) : (
                messages.map((message, index) => (
                  <article
                    className={message.role === "ROLE_USER" ? "bubble user" : "bubble agent-msg"}
                    key={`${message.at}-${index}`}
                  >
                    <span className="author">
                      {message.role === "ROLE_USER" ? "You" : (card?.name ?? "Agent")}
                    </span>
                    <p>{message.text}</p>
                  </article>
                ))
              )}
            </div>

            <form className="composer" action={sendChatMessage}>
              <input name="providerUrl" type="hidden" value={providerUrl} />
              <input name="customerId" type="hidden" value={customerId} />
              <input name="contextId" type="hidden" value={selectedConversation?.contextId ?? ""} />
              <textarea
                name="text"
                required
                rows={2}
                placeholder={selectedConversation ? "Reply…" : "Write a message…"}
                aria-label="Message"
                disabled={!card}
              />
              <button type="submit" className="primary" disabled={!card}>
                <SendHorizontal size={16} aria-hidden />
                Send
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
