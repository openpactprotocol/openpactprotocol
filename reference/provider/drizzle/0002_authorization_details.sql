ALTER TABLE "delegation_grants" ADD COLUMN "authorization_details" jsonb;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD COLUMN "authorization_details" jsonb;