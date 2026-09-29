import { and, asc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import {
  aops,
  agentPlatforms,
  conversations,
  customerPlatforms,
  customers,
  customerUsers,
} from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import type { ReactElement } from "react";
import { toggleAllowlist, toggleCustomer, togglePlatform, updateAopChannels } from "./actions.js";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; pa_platform?: string }>;
}): Promise<ReactElement> {
  const query = await searchParams;
  const db = getDb();
  const platforms = await db.select().from(agentPlatforms).orderBy(asc(agentPlatforms.name));
  const customerRows = await db.select().from(customers).orderBy(asc(customers.name));
  const platformAccess = await db.select().from(customerPlatforms);
  const aopRows = await db.select().from(aops).orderBy(asc(aops.id));
  const conversationRows = await db
    .select({
      id: conversations.id,
      customer: customers.name,
      channel: conversations.channel,
      paPlatform: sql<string>`${conversations.metadata}->>'pa_platform'`,
      paUserId: conversations.paUserId,
      state: conversations.state,
      aopId: conversations.aopId,
      verifiedName: customerUsers.fullName,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .leftJoin(customerUsers, eq(conversations.verifiedCustomerUserId, customerUsers.id))
    .where(
      and(
        query.channel ? eq(conversations.channel, query.channel) : undefined,
        query.pa_platform
          ? sql`${conversations.metadata}->>'pa_platform' = ${query.pa_platform}`
          : undefined,
      ),
    )
    .orderBy(sql`${conversations.updatedAt} desc`);
  return (
    <main>
      <h1>PAP provider admin</h1>
      <h2>Platforms</h2>
      {platforms.map((platform) => (
        <form action={togglePlatform} key={platform.id}>
          <input name="id" type="hidden" value={platform.id} />
          <input name="enabled" type="hidden" value={String(platform.enabled)} />
          <button type="submit">
            {platform.enabled ? "Disable" : "Enable"} {platform.name}
          </button>
          <span> {platform.issuer}</span>
        </form>
      ))}
      <h2>Customers and platform allowlists</h2>
      {customerRows.map((customer) => (
        <section key={customer.id}>
          <h3>{customer.name}</h3>
          <p>{customer.slug}</p>
          <form action={toggleCustomer}>
            <input name="id" type="hidden" value={customer.id} />
            <input name="enabled" type="hidden" value={String(customer.a2aEnabled)} />
            <button type="submit">
              A2A {customer.a2aEnabled ? "enabled" : "disabled"} — toggle
            </button>
          </form>
          {platforms.map((platform) => {
            const access = platformAccess.find(
              (item) => item.customerId === customer.id && item.platformId === platform.id,
            );
            return (
              <form action={toggleAllowlist} key={platform.id}>
                <input name="customerId" type="hidden" value={customer.id} />
                <input name="platformId" type="hidden" value={platform.id} />
                <input name="allowed" type="hidden" value={String(access?.allowed ?? false)} />
                <button type="submit">
                  {platform.name}: {access?.allowed ? "allowed" : "blocked"} — toggle
                </button>
              </form>
            );
          })}
        </section>
      ))}
      <h2>AOP channel visibility</h2>
      {aopRows.map((aop) => (
        <form action={updateAopChannels} key={`${aop.customerId}:${aop.id}`}>
          <input name="customerId" type="hidden" value={aop.customerId} />
          <input name="aopId" type="hidden" value={aop.id} />
          <strong>{aop.id}</strong>
          {(["chat", "voice", "a2a"] as const).map((channel) => (
            <label key={channel}>
              <input
                name={channel}
                type="checkbox"
                defaultChecked={aop.channels.includes(channel)}
              />{" "}
              {channel}
            </label>
          ))}
          <button type="submit">Save</button>
        </form>
      ))}
      <h2>Conversations</h2>
      <form action="/admin/conversations" method="get">
        <select name="channel" defaultValue={query.channel ?? ""}>
          <option value="">All channels</option>
          <option value="pa">PA</option>
          <option value="chat">Chat</option>
          <option value="voice">Voice</option>
        </select>
        <select name="pa_platform" defaultValue={query.pa_platform ?? ""}>
          <option value="">All platforms</option>
          {platforms.map((platform) => (
            <option key={platform.id} value={platform.name}>
              {platform.name}
            </option>
          ))}
        </select>
        <button type="submit">Filter</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>customer</th>
            <th>channel</th>
            <th>pa_platform</th>
            <th>pa_user_id</th>
            <th>state</th>
            <th>aop</th>
            <th>verified user</th>
            <th>updated</th>
          </tr>
        </thead>
        <tbody>
          {conversationRows.map((conversation) => (
            <tr key={conversation.id}>
              <td>
                <Link href={`/admin/conversations/${conversation.id}`}>{conversation.id}</Link>
              </td>
              <td>{conversation.customer}</td>
              <td>{conversation.channel}</td>
              <td>{conversation.paPlatform}</td>
              <td>{conversation.paUserId}</td>
              <td>{conversation.state}</td>
              <td>{conversation.aopId}</td>
              <td>{conversation.verifiedName}</td>
              <td>{conversation.updatedAt.toISOString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
