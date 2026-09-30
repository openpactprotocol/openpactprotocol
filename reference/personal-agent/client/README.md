# Demo PA

Next.js chat UI playing the PA side of the
[specification](../../../docs/spec.md): signs requests server-side, discovers
the Brands in `CUSTOMER_IDS`, routes each User message to the right Brand
agent, keeps one `contextId` per Brand. History lives in the ignored
`.data/pa-conversations.json`.

Configuration and behavior:
[Reference implementation → Demo PA](../../../docs/reference-implementation.md#demo-pa).
`.env.example` lists the variables.
