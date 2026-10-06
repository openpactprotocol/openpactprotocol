CREATE TABLE "delegation_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"platform_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"brand_user_id" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"platform_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"requested_scope" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"brand_user_id" text,
	"grant_id" text,
	"interval_seconds" integer NOT NULL,
	"last_polled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_authorizations_device_code_hash_unique" UNIQUE("device_code_hash"),
	CONSTRAINT "device_authorizations_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "used_brand_assertions" (
	"jti" text PRIMARY KEY NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "brand_user_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "delegation_grants" ADD CONSTRAINT "delegation_grants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_grants" ADD CONSTRAINT "delegation_grants_platform_id_agent_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."agent_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_platform_id_agent_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."agent_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_grant_id_delegation_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."delegation_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delegation_grants_user_idx" ON "delegation_grants" USING btree ("customer_id","brand_user_id");