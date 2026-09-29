import {
  boolean,
  date,
  index,
  integer,
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
  a2aEnabled: boolean("a2a_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aops = pgTable(
  "aops",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    channels: text("channels").array().notNull(),
    requiresVerification: boolean("requires_verification").notNull().default(false),
    tags: text("tags").array().notNull().default([]),
    examples: text("examples").array().notNull().default([]),
  },
  (table) => [primaryKey({ columns: [table.customerId, table.id] })],
);

export const customerUsers = pgTable(
  "customer_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    dateOfBirth: date("date_of_birth").notNull(),
  },
  (table) => [unique("customer_users_customer_email_unique").on(table.customerId, table.email)],
);

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  customerUserId: uuid("customer_user_id")
    .notNull()
    .references(() => customerUsers.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  providerName: text("provider_name").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull(),
});

export const agentPlatforms = pgTable("agent_platforms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  issuer: text("issuer").notNull().unique(),
  jwksUri: text("jwks_uri").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerPlatforms = pgTable(
  "customer_platforms",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => agentPlatforms.id, { onDelete: "cascade" }),
    allowed: boolean("allowed").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.customerId, table.platformId] })],
);

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
    channel: text("channel").notNull(),
    paUserId: text("pa_user_id").notNull(),
    contextId: text("context_id").notNull(),
    state: text("state").notNull(),
    aopId: text("aop_id"),
    verifiedCustomerUserId: uuid("verified_customer_user_id").references(() => customerUsers.id),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
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

export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    platformId: uuid("platform_id")
      .notNull()
      .references(() => agentPlatforms.id, { onDelete: "cascade" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.platformId, table.windowStart] })],
);

export const schema = {
  customers,
  aops,
  customerUsers,
  appointments,
  agentPlatforms,
  customerPlatforms,
  conversations,
  messages,
  seenJtis,
  rateLimitWindows,
};
