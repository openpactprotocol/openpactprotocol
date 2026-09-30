CREATE TABLE "agent_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"jwks_uri" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "agent_platforms_name_unique" UNIQUE("name"),
	CONSTRAINT "agent_platforms_issuer_unique" UNIQUE("issuer")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "customers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "customers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_conversation_message_unique" UNIQUE("conversation_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "seen_jtis" (
	"platform_id" uuid NOT NULL,
	"jti" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "seen_jtis_platform_id_jti_pk" PRIMARY KEY("platform_id","jti")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seen_jtis" ADD CONSTRAINT "seen_jtis_platform_id_agent_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."agent_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_owner_updated_idx" ON "conversations" USING btree ("customer_id","user_id","updated_at");