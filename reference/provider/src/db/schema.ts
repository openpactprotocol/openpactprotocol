import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { ulid } from "ulid";
import type { FlowState } from "../agent/index.js";

export type ConversationMetadata = {
  flow?: FlowState;
};

export const customers = pgTable("customers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => ulid()),
  name: text("name").notNull().unique(),
});

export const agentPlatforms = pgTable("agent_platforms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  issuer: text("issuer").notNull().unique(),
  jwksUri: text("jwks_uri").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  audience: text("audience"),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    metadata: jsonb("metadata").$type<ConversationMetadata>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("conversations_owner_updated_idx").on(table.customerId, table.userId, table.updatedAt),
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

export const schema = {
  customers,
  agentPlatforms,
  conversations,
  messages,
};
