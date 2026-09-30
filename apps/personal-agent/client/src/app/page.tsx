import Link from "next/link";
import { A2AClient, createPlatformSigner, discoverAgent } from "@pap/client";
import type { AgentCard, Message, Task } from "@pap/client";
import type { ReactElement } from "react";
import { sendChatMessage } from "./actions.js";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ providerUrl?: string; slug?: string; userId?: string; task?: string }>;
}): Promise<ReactElement> {
  const query = await searchParams;
  const providerUrl = query.providerUrl ?? process.env.PROVIDER_URL ?? "http://localhost:3000";
  const slug = query.slug ?? process.env.CUSTOMER_SLUG ?? "";
  const userId = query.userId ?? process.env.PA_USER_ID ?? "demo-user";
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  let card: AgentCard | undefined;
  let tasks: Task[] = [];
  let messages: Message[] = [];
  let selectedTask: Task | undefined;
  let error: string | undefined;
  if (slug && issuer && privateJwk) {
    try {
      const discovery = await discoverAgent(providerUrl, slug);
      card = discovery.card;
      const client = new A2AClient({
        url: discovery.url,
        signer: createPlatformSigner({ issuer, privateJwk }),
        userId,
      });
      tasks = (await client.listTasks({ pageSize: 100 })).tasks;
      if (query.task) {
        selectedTask = await client.getTask(query.task);
        messages = selectedTask.history ?? [];
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Could not connect to the provider.";
    }
  }
  const context = (task?: string) =>
    `/?providerUrl=${encodeURIComponent(providerUrl)}&slug=${encodeURIComponent(slug)}&userId=${encodeURIComponent(userId)}${task ? `&task=${encodeURIComponent(task)}` : ""}`;
  return (
    <main>
      <h1>Personal Agent Protocol</h1>
      <form action="/" method="get">
        <label>
          Provider URL <input name="providerUrl" defaultValue={providerUrl} />
        </label>
        <label>
          Customer slug <input name="slug" defaultValue={slug} />
        </label>
        <label>
          PA user ID <input name="userId" defaultValue={userId} />
        </label>
        <button type="submit">Connect</button>
      </form>
      {!issuer || !privateJwk ? (
        <p>Configure PA_ISSUER and PA_PRIVATE_JWK in the server environment.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {card ? (
        <section>
          <h2>{card.name}</h2>
          <p>{card.description}</p>
          <h3>Agent skills</h3>
          <ul>
            {card.skills.map((skill) => (
              <li key={skill.id}>
                {skill.name}: {skill.description}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="workspace">
        <aside>
          <h2>Conversations</h2>
          <Link href={context()}>＋ New conversation</Link>
          <ul>
            {tasks.map((task) => (
              <li key={task.id}>
                <Link href={context(task.id)}>
                  <span>{task.status.state.replace("TASK_STATE_", "")}</span> ·{" "}
                  {task.id.slice(0, 8)}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        <section>
          <h2>
            {selectedTask ? `Conversation ${selectedTask.id.slice(0, 8)}` : "New conversation"}
          </h2>
          {selectedTask ? <p className="badge">{selectedTask.status.state}</p> : null}
          <div className="thread">
            {messages.map((message) => (
              <article
                className={message.role === "ROLE_USER" ? "user" : "agent"}
                key={message.messageId}
              >
                <strong>{message.role === "ROLE_USER" ? "You" : "Agent"}</strong>
                <p>
                  {message.parts
                    .map((part) => ("text" in part ? part.text : "[non-text part]"))
                    .join("\n")}
                </p>
              </article>
            ))}
          </div>
          <form action={sendChatMessage}>
            <input name="providerUrl" type="hidden" value={providerUrl} />
            <input name="slug" type="hidden" value={slug} />
            <input name="userId" type="hidden" value={userId} />
            <input name="taskId" type="hidden" value={selectedTask?.id ?? ""} />
            <label>
              Message <textarea name="text" required rows={3} />
            </label>
            <button type="submit">Send</button>
          </form>
        </section>
      </div>
    </main>
  );
}
