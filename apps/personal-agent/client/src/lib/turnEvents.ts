import type { BusinessThread, PhoneMessage } from "./conversationStore.js";

export type TurnEvent =
  | { type: "business-start"; customerId: string; businessName: string; text: string }
  | { type: "business"; thread: BusinessThread }
  | { type: "business-error"; customerId: string; businessName: string; message: string }
  | { type: "reply"; message: PhoneMessage }
  | { type: "done"; href: string }
  | { type: "error"; message: string };
