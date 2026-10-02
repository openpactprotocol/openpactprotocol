import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
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
    brandUserId: text("brand_user_id"),
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
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("messages_conversation_message_unique").on(table.conversationId, table.messageId),
  ],
);

export type DeviceAuthorizationStatus = "pending" | "approved" | "denied" | "consumed";

export const deviceAuthorizations = pgTable("device_authorizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  platformId: uuid("platform_id")
    .notNull()
    .references(() => agentPlatforms.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  deviceCodeHash: text("device_code_hash").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  requestedScope: text("requested_scope").notNull(),
  status: text("status").$type<DeviceAuthorizationStatus>().notNull().default("pending"),
  brandUserId: text("brand_user_id"),
  grantId: text("grant_id"),
  intervalSeconds: integer("interval_seconds").notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const delegationGrants = pgTable(
  "delegation_grants",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => agentPlatforms.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    brandUserId: text("brand_user_id").notNull(),
    scope: text("scope").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("delegation_grants_user_idx").on(table.customerId, table.brandUserId)],
);

export const refreshTokens = pgTable("refresh_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  grantId: text("grant_id")
    .notNull()
    .references(() => delegationGrants.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usedBrandAssertions = pgTable("used_brand_assertions", {
  jti: text("jti").primaryKey(),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  customers,
  agentPlatforms,
  conversations,
  messages,
  deviceAuthorizations,
  delegationGrants,
  refreshTokens,
  usedBrandAssertions,
};
