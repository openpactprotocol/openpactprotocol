CREATE TABLE "customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "public_id" text NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "a2a_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customers_public_id_unique" UNIQUE("public_id"),
  CONSTRAINT "customers_slug_unique" UNIQUE("slug"),
  CONSTRAINT "customers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "aops" (
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "id" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "channels" text[] NOT NULL,
  "requires_verification" boolean DEFAULT false NOT NULL,
  "tags" text[] DEFAULT '{}' NOT NULL,
  "examples" text[] DEFAULT '{}' NOT NULL,
  CONSTRAINT "aops_customer_id_id_pk" PRIMARY KEY("customer_id", "id")
);
--> statement-breakpoint
CREATE TABLE "customer_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "full_name" text NOT NULL,
  "date_of_birth" date NOT NULL,
  CONSTRAINT "customer_users_customer_email_unique" UNIQUE("customer_id", "email")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "customer_user_id" uuid NOT NULL REFERENCES "customer_users"("id") ON DELETE CASCADE,
  "starts_at" timestamp with time zone NOT NULL,
  "provider_name" text NOT NULL,
  "description" text NOT NULL,
  "status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_platforms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "issuer" text NOT NULL,
  "jwks_uri" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_platforms_name_unique" UNIQUE("name"),
  CONSTRAINT "agent_platforms_issuer_unique" UNIQUE("issuer")
);
--> statement-breakpoint
CREATE TABLE "customer_platforms" (
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "platform_id" uuid NOT NULL REFERENCES "agent_platforms"("id") ON DELETE CASCADE,
  "allowed" boolean DEFAULT false NOT NULL,
  CONSTRAINT "customer_platforms_customer_id_platform_id_pk" PRIMARY KEY("customer_id", "platform_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "platform_id" uuid NOT NULL REFERENCES "agent_platforms"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "pa_user_id" text NOT NULL,
  "context_id" text NOT NULL,
  "state" text NOT NULL,
  "aop_id" text,
  "verified_customer_user_id" uuid REFERENCES "customer_users"("id"),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "conversations_owner_updated_idx" ON "conversations" ("customer_id", "platform_id", "pa_user_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "message_id" text NOT NULL,
  "role" text NOT NULL,
  "parts" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "messages_conversation_message_unique" UNIQUE("conversation_id", "message_id")
);
--> statement-breakpoint
CREATE TABLE "seen_jtis" (
  "platform_id" uuid NOT NULL REFERENCES "agent_platforms"("id") ON DELETE CASCADE,
  "jti" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "seen_jtis_platform_id_jti_pk" PRIMARY KEY("platform_id", "jti")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_windows" (
  "platform_id" uuid NOT NULL REFERENCES "agent_platforms"("id") ON DELETE CASCADE,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "rate_limit_windows_platform_id_window_start_pk" PRIMARY KEY("platform_id", "window_start")
);
