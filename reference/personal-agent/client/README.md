# Demo personal agent

Next.js chat UI playing the personal-agent side of the
[specification](../../../docs/spec.md): signs requests server-side, discovers
the Brands in `CUSTOMER_IDS`, routes each User message to the right Brand
agent, keeps one `contextId` per Brand. History lives in the ignored
`.data/pa-conversations.json`.

Configuration and behavior:
[Run the reference stack](../../../docs/running.md#run-it-locally).
`.env.example` lists the variables.
