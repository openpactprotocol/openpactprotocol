import Link from "next/link";
import { A2AClient, A2AHttpError, createPlatformSigner, discoverAgent } from "@pap/client";
import type { AgentCard, Message, Task, TaskState } from "@pap/protocol";
import {
  Bot,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Headset,
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
import { connect, newUser, registerPersonalAgent, sendChatMessage } from "./actions.js";

export const dynamic = "force-dynamic";

const TERMINAL_STATES: TaskState[] = [
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
];

function stateLabel(state: TaskState): string {
  const words = state.replace("TASK_STATE_", "").toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function stateClass(state: TaskState): string {
  return `pill state-${state.replace("TASK_STATE_", "").toLowerCase().replace(/_/g, "-")}`;
}

function StateIcon({ state }: { state: TaskState }): ReactElement {
  if (state === "TASK_STATE_COMPLETED") return <CircleCheck size={12} aria-hidden />;
  if (TERMINAL_STATES.includes(state)) return <CircleX size={12} aria-hidden />;
  return <Clock size={12} aria-hidden />;
}

function StatePill({ state }: { state: TaskState }): ReactElement {
  return (
    <span className={stateClass(state)}>
      <StateIcon state={state} />
      {stateLabel(state)}
    </span>
  );
}

function messageText(message: Message): string {
  return message.parts.map((part) => ("text" in part ? part.text : "[non-text part]")).join("\n");
}

function taskPreview(task: Task): string {
  const first = task.history?.find((message) => message.role === "ROLE_USER");
  return first ? messageText(first) : "Untitled conversation";
}

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
  slug: string;
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
          <input name="slug" type="hidden" value={input.slug} />
          <label>
            <span>Platform name</span>
            <input name="platformName" defaultValue={input.notice?.name ?? defaultPlatformName()} />
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

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    providerUrl?: string;
    slug?: string;
    task?: string;
    registration?: string;
    platformName?: string;
    registrationError?: string;
  }>;
}): Promise<ReactElement> {
  const query = await searchParams;
  const providerUrl = query.providerUrl ?? process.env.PROVIDER_URL ?? "http://localhost:3000";
  const slug = query.slug ?? process.env.CUSTOMER_SLUG ?? "";
  const userId = (await cookies()).get(USER_ID_COOKIE)?.value ?? "";
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  let card: AgentCard | undefined;
  let tasks: Task[] = [];
  let selectedTask: Task | undefined;
  let error: string | undefined;
  let unauthorized = false;
  const registration = readRegistrationNotice(query);
  if (slug && userId && issuer && privateJwk) {
    try {
      const discovery = await discoverAgent(providerUrl, slug);
      card = discovery.card;
      const client = new A2AClient({
        url: discovery.url,
        signer: createPlatformSigner({ issuer, privateJwk }),
        userId,
      });
      tasks = (await client.listTasks({ pageSize: 100 })).tasks;
      if (query.task) selectedTask = await client.getTask(query.task);
    } catch (cause) {
      unauthorized = cause instanceof A2AHttpError && cause.status === 401;
      error = unauthorized
        ? "The provider rejected this platform's token (401). Is this personal agent registered with the provider?"
        : cause instanceof Error
          ? cause.message
          : "Could not connect to the provider.";
    }
  }
  const messages = selectedTask?.history ?? [];
  const closed = selectedTask ? TERMINAL_STATES.includes(selectedTask.status.state) : false;
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
            <h1>Personal Agent Protocol</h1>
            <p>Local personal-agent client</p>
          </div>
        </div>
      </header>

      <main>
        <form className="card connect" action={connect}>
          <label>
            <span>Provider URL</span>
            <input name="providerUrl" defaultValue={providerUrl} />
          </label>
          <label>
            <span>Customer slug</span>
            <input name="slug" defaultValue={slug} placeholder="abc1234_customer" />
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
            slug={slug}
            issuer={issuer}
            open={unauthorized || registration !== undefined}
            notice={registration}
          />
        ) : null}

        <div className="workspace">
          <aside className="card sidebar">
            <div className="sidebar-head">
              <h2>Conversations</h2>
              <Link className="button secondary small" href={homePath({ providerUrl, slug })}>
                <SquarePen size={14} aria-hidden />
                New chat
              </Link>
            </div>
            {tasks.length === 0 ? (
              <div className="empty">
                <MessagesSquare size={20} aria-hidden />
                No conversations yet.
              </div>
            ) : (
              <ul className="task-list">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <Link
                      href={homePath({ providerUrl, slug, task: task.id })}
                      className={task.id === selectedTask?.id ? "task active" : "task"}
                    >
                      <span className="preview">{taskPreview(task)}</span>
                      <span className="task-meta">
                        <StatePill state={task.status.state} />
                        <span>{formatTime(task.status.timestamp)}</span>
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
                  <p>Enter a provider URL and customer slug, then connect.</p>
                </div>
              </header>
            )}

            <div className="thread-head">
              <h3>{selectedTask ? `Task ${selectedTask.id.slice(0, 8)}` : "New conversation"}</h3>
              {selectedTask ? <StatePill state={selectedTask.status.state} /> : null}
            </div>

            <div className="thread">
              {messages.length === 0 ? (
                <div className="empty">
                  <MessageCircle size={28} aria-hidden />
                  Ask about hours, location, parking, or insurance.
                </div>
              ) : (
                messages.map((message) => (
                  <article
                    className={message.role === "ROLE_USER" ? "bubble user" : "bubble agent-msg"}
                    key={message.messageId}
                  >
                    <span className="author">
                      {message.role === "ROLE_USER" ? "You" : (card?.name ?? "Agent")}
                    </span>
                    <p>{messageText(message)}</p>
                  </article>
                ))
              )}
            </div>

            {closed ? (
              <p className="closed">
                <CircleCheck size={16} aria-hidden />
                <span>
                  This conversation is complete.{" "}
                  <Link href={homePath({ providerUrl, slug })}>Start a new one</Link>.
                </span>
              </p>
            ) : (
              <form className="composer" action={sendChatMessage}>
                <input name="providerUrl" type="hidden" value={providerUrl} />
                <input name="slug" type="hidden" value={slug} />
                <input name="taskId" type="hidden" value={selectedTask?.id ?? ""} />
                <textarea
                  name="text"
                  required
                  rows={2}
                  placeholder={selectedTask ? "Reply…" : "Write a message…"}
                  aria-label="Message"
                  disabled={!card}
                />
                <button type="submit" className="primary" disabled={!card}>
                  <SendHorizontal size={16} aria-hidden />
                  Send
                </button>
              </form>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
