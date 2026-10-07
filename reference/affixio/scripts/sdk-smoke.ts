import assert from "node:assert/strict";
import { createActionGuard } from "../src/guard.js";
import { createSdkAuthorizer } from "../src/sdk.js";
import { action, authorization, brand, NOW, secret, tool } from "../test/fixtures.js";

const sdk = await import(process.env.AFFIX_SDK_MODULE ?? "affixio/workflows");
assert.equal(typeof sdk.evaluatePolicy, "function");
let executed = 0;
for (const amountMinor of [0, 1]) {
  const definition = tool();
  definition.describe = () => ({ resource: "skyline:rebooking", amountMinor, currency: "GBP" });
  const guard = createActionGuard({
    brand, bindingSecret: secret, tools: [definition], getAuthorization: async () => authorization(),
    authorize: createSdkAuthorizer(sdk.evaluatePolicy, () => NOW), clock: () => NOW,
  });
  const result = guard.execute(action(), async () => { executed += 1; return "executed"; });
  if (amountMinor === 0) assert.equal((await result).value, "executed");
  else await assert.rejects(result, { reason: "deny" });
}
assert.equal(executed, 1);
console.log("Real AffixIO SDK: zero-fee action allowed; over-limit action blocked; one execution.");
