import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createApiAuthorizer } from "./api.js";
import { ActionBlocked, createActionGuard, type Authorize, type Authorization, type Tool } from "./guard.js";

const brand = "https://provider.example/a2a/skyline";
const argsSchema = z.object({ confirmation: z.string().min(1), flight: z.string().min(1) }).strict();
const tool: Tool = {
  name: "rebook_trip", requiredScopes: ["flights:rebook"], parse: (args) => argsSchema.parse(args),
  describe: () => ({ resource: "skyline:rebooking", amountMinor: 0, currency: "GBP" }),
  policy: {
    id: "skyline-free-rebooking-v1", allowed_actions: ["rebook_trip"], allowed_tools: ["rebook_trip"],
    allowed_resources: ["skyline:rebooking"], max_amount_minor: 0, currency: "GBP",
    require_human_approval: false, human_approved: false, review_on_unknown: false,
  },
};
const live = process.argv.includes("--live");
const apiKey = process.env.AFFIX_API_KEY;
if (live && !apiKey) throw new Error("Set AFFIX_API_KEY for the live API demo");
const auth: Authorization = {
  brand, pa: "https://pa.example", paSubject: "demo-pa-user", user: "demo-brand-user",
  grantId: "demo-grant", scopes: ["flights:rebook"], expiresAt: Date.now() + 60_000,
};
const fixture: Authorize = async (request) => ({
  decision: "allow", binding: request.context.binding, evidence: { fixture: true },
});
const guard = createActionGuard({
  brand, bindingSecret: randomBytes(32).toString("hex"), tools: [tool],
  getAuthorization: async () => auth,
  authorize: live ? createApiAuthorizer({ apiKey: apiKey! }) : fixture,
});
const input = {
  tool: "rebook_trip", args: { confirmation: "DEMO-1", flight: "SK 102" },
  contextId: "demo-context", messageId: "demo-message", actionId: "rebook-1",
};
const result = await guard.execute(input, async (args) => ({ simulated: true, booking: args }));
console.log(JSON.stringify({ mode: live ? "live-api-simulated-booking" : "offline-fixture", ...result }, null, 2));
auth.scopes = [];
try {
  await guard.execute({ ...input, messageId: "no-consent" }, async () => { throw new Error("Must not execute"); });
} catch (error) {
  if (!(error instanceof ActionBlocked)) throw error;
  console.log(JSON.stringify({ blocked: error.reason, missingScopes: error.missingScopes }));
}
