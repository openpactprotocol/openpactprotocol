import Link from "next/link";
import { A2AHttpError, discoverAgent } from "@pac2/client";
import type { AgentCard } from "@pac2/protocol";
import {
  ArrowUp,
  BatteryFull,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Headset,
  Fingerprint,
  Info,
  KeyRound,
  Link as LinkIcon,
  Lock,
  MessagesSquare,
  Plug,
  RotateCw,
  SignalHigh,
  Sparkles,
  SquarePen,
  Wifi,
} from "lucide-react";
import { cookies } from "next/headers";
import type { ReactElement } from "react";
import {
  defaultPlatformName,
  homePath,
  parseCustomerIds,
  readRegistrationNotice,
  USER_ID_COOKIE,
  type RegistrationNotice,
} from "../lib/session.js";
import {
  listConversations,
  type PaConversation,
  type PhoneMessage,
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

function formatDay(timestamp: string | undefined): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = formatClock(timestamp);
  if (sameDay) return `Today ${time}`;
  return `${date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

function formatClock(timestamp: string | undefined): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function lastUserIndex(messages: PhoneMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function agentCardUrl(providerUrl: string, customerId: string): string {
  return `${providerUrl.replace(/\/+$/, "")}/a2a/${encodeURIComponent(customerId)}/.well-known/agent-card.json`;
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
  customerIds: string[];
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
          <input name="customerIds" type="hidden" value={input.customerIds.join(",")} />
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
    customerIds?: string;
    conversation?: string;
    registration?: string;
    platformName?: string;
    registrationError?: string;
  }>;
}): Promise<ReactElement> {
  const query = await searchParams;
  const providerUrl = query.providerUrl ?? process.env.PROVIDER_URL ?? "http://localhost:3000";
  const customerIds = parseCustomerIds(query.customerIds ?? process.env.CUSTOMER_IDS);
  const firstCustomerId = customerIds[0];
  const userId = (await cookies()).get(USER_ID_COOKIE)?.value ?? "";
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  let card: AgentCard | undefined;
  let conversations: PaConversation[] = [];
  let selectedConversation: PaConversation | undefined;
  let error: string | undefined;
  let unauthorized = false;
  const registration = readRegistrationNotice(query);
  if (userId) {
    conversations = await listConversations({ userId, providerUrl });
    selectedConversation = conversations.find(
      (conversation) => conversation.id === query.conversation,
    );
  }
  if (firstCustomerId && issuer && privateJwk) {
    try {
      const discovery = await discoverAgent(providerUrl, firstCustomerId);
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
  const messages: PhoneMessage[] = selectedConversation?.messages ?? [];
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
            <span>Businesses</span>
            <input
              name="customerIds"
              defaultValue={customerIds.join(",")}
              placeholder="Customer IDs"
            />
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
            customerIds={customerIds}
            issuer={issuer}
            open={unauthorized || registration !== undefined}
            notice={registration}
          />
        ) : null}

        <div className="workspace">
          <div className="peripherals">
            <section className="card agent-card">
              <h2>Agent Card</h2>
              {card ? (
                <div className="agent">
                  <span className="avatar" aria-hidden>
                    <Headset size={20} />
                  </span>
                  <div className="agent-body">
                    <h3>{card.name}</h3>
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
                </div>
              ) : (
                <p className="muted-text">Enter a provider URL and business IDs, then connect.</p>
              )}
            </section>

            <aside className="card sidebar">
              <div className="sidebar-head">
                <h2>Conversations</h2>
                <Link
                  className="button secondary small"
                  href={homePath({ providerUrl, customerIds })}
                >
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
                    <li key={conversation.id}>
                      <Link
                        href={homePath({
                          providerUrl,
                          customerIds,
                          conversationId: conversation.id,
                        })}
                        className={
                          conversation.id === selectedConversation?.id
                            ? "conversation-link active"
                            : "conversation-link"
                        }
                      >
                        <span className="preview">
                          {conversation.messages.find((message) => message.role === "user")?.text ??
                            "Untitled conversation"}
                        </span>
                        <span className="conversation-meta">
                          <span>{formatTime(conversation.updatedAt)}</span>
                          <code>{conversation.id.slice(0, 8)}</code>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>

          <section className="stage" aria-label="Chat">
            <div className="phone">
              <div className="screen">
                <div className="status-bar" aria-hidden>
                  <span className="clock">9:41</span>
                  <span className="island" />
                  <span className="status-icons">
                    <SignalHigh size={16} strokeWidth={2.5} />
                    <Wifi size={16} strokeWidth={2.5} />
                    <BatteryFull size={20} strokeWidth={2} />
                  </span>
                </div>

                <header className="contact">
                  <Link
                    className="round-button"
                    href={homePath({ providerUrl, customerIds })}
                    aria-label="New conversation"
                    title="New conversation"
                  >
                    <ChevronLeft size={20} aria-hidden />
                  </Link>
                  <div className="contact-center">
                    <span className="contact-avatar" aria-hidden>
                      <Sparkles size={22} />
                    </span>
                    <span className="contact-name">
                      Personal Agent
                      <ChevronRight size={14} aria-hidden />
                    </span>
                  </div>
                  {card ? (
                    <a
                      className="round-button"
                      href={firstCustomerId ? agentCardUrl(providerUrl, firstCustomerId) : "#"}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${card.name} Agent Card`}
                      title={`Open ${card.name} Agent Card`}
                    >
                      <Info size={18} aria-hidden />
                    </a>
                  ) : (
                    <span className="round-button placeholder" aria-hidden />
                  )}
                </header>

                <div className="thread">
                  <div className="thread-inner">
                    <div className="thread-meta">
                      <span>
                        {card ? (
                          <>
                            Connected to <strong>{customerIds.length} businesses</strong> via PAC2
                          </>
                        ) : (
                          "Not connected to any business"
                        )}
                      </span>
                      {card ? (
                        <span>
                          <Lock size={10} aria-hidden />
                          {[agentInterface?.protocolBinding, auth].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                    {messages.length === 0 ? null : (
                      <>
                        <p className="timestamp">{formatDay(messages[0]?.at)}</p>
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
                                  {message.role === "business"
                                    ? message.businessName
                                    : "Personal Agent"}
                                </span>
                              ) : null}
                              <p className="bubble">{message.text}</p>
                              {message.role === "user" && index === lastUserIndex(messages) ? (
                                <span className="receipt">
                                  {messages[index + 1] ? (
                                    <>
                                      <strong>Read</strong> {formatClock(messages[index + 1]?.at)}
                                    </>
                                  ) : (
                                    "Delivered"
                                  )}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>

                <form className="composer" action={sendChatMessage}>
                  <input name="providerUrl" type="hidden" value={providerUrl} />
                  <input name="customerIds" type="hidden" value={customerIds.join(",")} />
                  <input
                    name="conversationId"
                    type="hidden"
                    value={selectedConversation?.id ?? ""}
                  />
                  <div className="composer-pill">
                    <input
                      name="text"
                      required
                      autoComplete="off"
                      placeholder={card ? "Message" : "Not connected"}
                      aria-label="Message"
                      disabled={!card}
                    />
                    <button
                      type="submit"
                      className="send"
                      disabled={!card}
                      aria-label="Send"
                      title="Send"
                    >
                      <ArrowUp size={16} strokeWidth={3} aria-hidden />
                    </button>
                  </div>
                </form>
                <span className="home-indicator" aria-hidden />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
