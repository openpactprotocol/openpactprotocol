import Link from "next/link";
import { A2AHttpError, discoverAgent } from "@pac2/client";
import type { AgentCard } from "@pac2/protocol";
import {
  Bot,
  CircleAlert,
  CircleCheck,
  CircleX,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Link as LinkIcon,
  Lock,
  MessagesSquare,
  Plug,
  RotateCw,
  Sparkles,
  SquarePen,
  Store,
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
import { brandColor } from "../lib/brand.js";
import { DEMO_USER_PROFILE } from "../lib/userProfile.js";
import {
  listConversations,
  type PaConversation,
  type PhoneMessage,
} from "../lib/conversationStore.js";
import { connect, newUser, registerPersonalAgent } from "./actions.js";
import { ChatStage } from "./ChatStage.js";

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

function agentCardUrl(providerUrl: string, customerId: string): string {
  return `${providerUrl.replace(/\/+$/, "")}/a2a/${encodeURIComponent(customerId)}/.well-known/agent-card.json`;
}

type ConnectedBusiness = {
  customerId: string;
  card?: AgentCard;
  error?: string;
  unauthorized?: boolean;
};

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
        <span className="summary-hint">One-time platform onboarding</span>
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
    <div
      className="identity"
      title={[input.issuer, kid ? `kid ${kid}` : undefined].filter(Boolean).join("\n")}
    >
      <span className="identity-label">
        <Fingerprint size={14} aria-hidden />
        Signing as
      </span>
      <span className="identity-name">{defaultPlatformName()}</span>
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
  const userId = (await cookies()).get(USER_ID_COOKIE)?.value ?? "";
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  const audience = process.env.PA_AUDIENCE;
  let conversations: PaConversation[] = [];
  let selectedConversation: PaConversation | undefined;
  const registration = readRegistrationNotice(query);
  if (userId) {
    conversations = await listConversations({ userId, providerUrl });
    selectedConversation = conversations.find(
      (conversation) => conversation.id === query.conversation,
    );
  }
  const businesses: ConnectedBusiness[] =
    issuer && privateJwk
      ? await Promise.all(
          customerIds.map(async (customerId): Promise<ConnectedBusiness> => {
            try {
              return { customerId, card: (await discoverAgent(providerUrl, customerId)).card };
            } catch (cause) {
              return {
                customerId,
                unauthorized: cause instanceof A2AHttpError && cause.status === 401,
                error: cause instanceof Error ? cause.message : "Could not reach this business.",
              };
            }
          }),
        )
      : [];
  const unauthorized = businesses.some((business) => business.unauthorized);
  const error = unauthorized
    ? "The provider rejected this platform's token (401). Is this personal agent registered with the provider?"
    : undefined;
  const card = businesses.find((business) => business.card)?.card;
  const threads = selectedConversation?.threads ?? [];
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
            <h1>PACT</h1>
            <p>Personal Agent Consent & Trust</p>
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

        {!issuer || !privateJwk || !audience ? (
          <p className="alert">
            <CircleAlert size={16} aria-hidden />
            Configure PA_ISSUER, PA_PRIVATE_JWK, and PA_AUDIENCE in the server environment.
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
              <h2>Connected businesses</h2>
              {businesses.length === 0 ? (
                <p className="muted-text">Enter a provider URL and business IDs, then connect.</p>
              ) : (
                <ul className="business-list">
                  {businesses.map((business) => (
                    <li className="business" key={business.customerId}>
                      <span
                        className="brand-avatar"
                        style={{ background: brandColor(customerIds, business.customerId) }}
                        aria-hidden
                      >
                        {business.card ? business.card.name.charAt(0) : <Store size={16} />}
                      </span>
                      <div className="business-body">
                        <div className="business-head">
                          <h3>{business.card?.name ?? "Unavailable"}</h3>
                          <a
                            href={agentCardUrl(providerUrl, business.customerId)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open Agent Card"
                            title="Open Agent Card"
                          >
                            <ExternalLink size={13} aria-hidden />
                          </a>
                        </div>
                        <p>{business.card?.description ?? business.error}</p>
                        <div className="chips">
                          {business.card?.skills.map((skill) => (
                            <span className="chip" key={skill.id} title={skill.description}>
                              <Sparkles size={12} aria-hidden />
                              {skill.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {card ? (
                <div className="chips">
                  {agentInterface ? (
                    <span className="chip muted">
                      <LinkIcon size={12} aria-hidden />
                      {agentInterface.protocolBinding} {agentInterface.protocolVersion}
                    </span>
                  ) : null}
                  {auth ? (
                    <span className="chip muted">
                      <Lock size={12} aria-hidden />
                      {auth}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="card agent-card personal-context">
              <h2>Personal context</h2>
              <ul>
                {DEMO_USER_PROFILE.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
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
                        {conversation.threads.length > 0 ? (
                          <span className="conversation-businesses">
                            {conversation.threads.map((thread) => thread.businessName).join(" · ")}
                          </span>
                        ) : null}
                        <span className="conversation-meta">
                          <span>{formatTime(conversation.updatedAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>

          <ChatStage
            messages={messages}
            threads={threads}
            dayLabel={formatDay(messages[0]?.at ?? new Date().toISOString())}
            providerUrl={providerUrl}
            customerIds={customerIds}
            conversationId={selectedConversation?.id ?? ""}
            connected={Boolean(card)}
          />
        </div>
      </main>
    </div>
  );
}
