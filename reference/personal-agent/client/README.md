# Demo personal agent

Next.js chat UI playing the personal-agent side of the
[specification](https://openpactprotocol.org/spec): signs requests server-side, discovers
the Brands in `CUSTOMER_IDS`, routes each User message to the right Brand
agent, keeps one `contextId` per Brand. History lives in the ignored
`.data/pa-conversations.json`.

Configuration and behavior:
[Run the reference stack](https://openpactprotocol.org/running#run-it-locally).
`.env.example` lists the variables.
