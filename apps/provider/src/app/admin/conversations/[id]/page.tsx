import { asc, eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { conversations, messages } from "../../../../db/schema.js";
import { getDb } from "../../../../db/client.js";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  const [conversation] = await getDb()
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  if (!conversation)
    return (
      <main>
        <h1>Conversation not found</h1>
      </main>
    );
  const history = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  return (
    <main>
      <h1>Conversation {conversation.id}</h1>
      <p>
        {conversation.state} · {conversation.channel} · {conversation.paUserId}
      </p>
      {history.map((message) => (
        <article key={message.id}>
          <h2>{message.role}</h2>
          <pre>{JSON.stringify(message.parts, null, 2)}</pre>
        </article>
      ))}
    </main>
  );
}
