import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicId: text("public_id").notNull().unique(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull().unique(),
});

export const agentPlatforms = pgTable("agent_platforms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  issuer: text("issuer").notNull().unique(),
  jwksUri: text("jwks_uri").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => agentPlatforms.id, { onDelete: "cascade" }),
    paUserId: text("pa_user_id").notNull(),
    contextId: text("context_id").notNull(),
    state: text("state").notNull(),
    flow: jsonb("flow").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("conversations_owner_updated_idx").on(
      table.customerId,
      table.platformId,
      table.paUserId,
      table.updatedAt,
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    role: text("role").notNull(),
    parts: jsonb("parts").$type<unknown[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("messages_conversation_message_unique").on(table.conversationId, table.messageId),
  ],
);

export const seenJtis = pgTable(
  "seen_jtis",
  {
    platformId: uuid("platform_id")
      .notNull()
      .references(() => agentPlatforms.id, { onDelete: "cascade" }),
    jti: text("jti").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.platformId, table.jti] })],
);

export const schema = {
  customers,
  agentPlatforms,
  conversations,
  messages,
  seenJtis,
};
