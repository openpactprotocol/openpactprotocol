import { replyWithOpenAI } from "./llmAgent.js";

export type FlowState = {
  awaitingDetail?: boolean;
  escalated?: boolean;
};

export type AgentTurn = {
  text: string;
  flow: FlowState;
};

export type BusinessProfile = {
  description: string;
  skill: {
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples: string[];
  };
  followUp: string;
  detail: RegExp;
  detailHint: string;
  answer: string;
  facts: string;
};

export const GENERIC_PROFILE: BusinessProfile = {
  description: "Customer support.",
  skill: {
    id: "support",
    name: "Support",
    description: "General customer support.",
    tags: ["support", "help"],
    examples: ["Can you help me?"],
  },
  followUp: "Could you share a reference number so I can look into this?",
  detail: /\b\d{3,}\b/,
  detailHint: "a reference number",
  answer: "Thanks, I found it and everything is on track.",
  facts: "Thanks, I found it and everything is on track.",
};

const BUSINESS_PROFILES: Record<string, BusinessProfile> = {
  "Skyline Airways": {
    description: "Flight status and trip changes.",
    skill: {
      id: "flight-status",
      name: "Flight status",
      description: "Check departure and arrival times for a booked flight.",
      tags: [
        "flight",
        "flights",
        "airline",
        "delay",
        "delayed",
        "departure",
        "boarding",
        "gate",
        "trip",
      ],
      examples: ["Is my Friday flight on time?"],
    },
    followUp: "I can check that. What's your confirmation code?",
    detail: /\b(?=[A-Z0-9]{6}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6}\b/,
    detailHint: "the six-character booking confirmation code (for example ABC123)",
    answer:
      "Flight SK 482 on Friday is delayed 4.5 hours. It now leaves SFO at 2:40 PM and lands at O'Hare at 8:50 PM.",
    facts:
      "Flight SK 482 on Friday is delayed 4.5 hours. It now leaves SFO at 2:40 PM and lands at O'Hare at 8:50 PM.",
  },
  "Loom & Co.": {
    description: "Order tracking and delivery changes.",
    skill: {
      id: "order-status",
      name: "Order status",
      description: "Track an order and change its delivery.",
      tags: [
        "order",
        "orders",
        "delivery",
        "deliver",
        "shipping",
        "package",
        "dress",
        "clothes",
        "return",
      ],
      examples: ["Can my order arrive Saturday?"],
    },
    followUp: "Happy to help with your order. What's the order number?",
    detail: /(?:\bLC-?\d{3,}\b|\b\d{4,}\b)/i,
    detailHint: "the order number (for example LC-1042)",
    answer:
      "Order LC-1042 (linen dress) is out for delivery today by 6 PM. I can also hold it for Saturday morning delivery if that's better.",
    facts:
      "Order LC-1042 (linen dress) is out for delivery today by 6 PM. I can also hold it for Saturday morning delivery if that's better.",
  },
  "Bloom & Stem": {
    description: "Flower orders and delivery.",
    skill: {
      id: "flower-orders",
      name: "Flower orders",
      description: "Check or change a flower arrangement delivery.",
      tags: [
        "flowers",
        "flower",
        "bouquet",
        "bouquets",
        "florist",
        "roses",
        "arrangement",
        "wedding",
        "centerpiece",
      ],
      examples: ["When do the wedding flowers arrive?"],
    },
    followUp: "Congratulations! What's the order number for the arrangement?",
    detail: /(?:\bBS-?\d{3,}\b|\b\d{4,}\b)/i,
    detailHint: "the order number (for example BS-3001)",
    answer:
      "Order BS-3001 (white rose centerpieces) arrives at the Drake Hotel on Saturday at 10 AM.",
    facts:
      "Order BS-3001 (white rose centerpieces) arrives at the Drake Hotel on Saturday at 10 AM.",
  },
};

export function businessProfile(customerName: string): BusinessProfile {
  return BUSINESS_PROFILES[customerName] ?? GENERIC_PROFILE;
}

function escalation(customerName: string, flow: FlowState): AgentTurn {
  return {
    text: `A human will follow up via ${customerName}'s normal support channel.`,
    flow: { ...flow, awaitingDetail: false, escalated: true },
  };
}

export async function runAgentTurn(input: {
  customerName: string;
  initialText: string;
  previousFlow: FlowState;
  history: { role: "customer" | "agent"; text: string }[];
  openai?: { apiKey: string; model: string; fetchImpl?: typeof fetch };
}): Promise<AgentTurn> {
  const flow = { ...input.previousFlow };
  if (flow.escalated) {
    return escalation(input.customerName, flow);
  }

  const profile = businessProfile(input.customerName);
  if (input.openai) {
    try {
      return await replyWithOpenAI({
        customerName: input.customerName,
        profile,
        history: input.history,
        text: input.initialText,
        ...input.openai,
      });
    } catch {
      console.warn("OpenAI business agent reply failed; using deterministic response");
    }
  }

  if (/\b(human|agent|representative|person)\b/i.test(input.initialText)) {
    return escalation(input.customerName, flow);
  }

  if (profile.detail.test(input.initialText)) {
    return {
      text: profile.answer,
      flow: { awaitingDetail: false, escalated: false },
    };
  }

  return {
    text: profile.followUp,
    flow: { awaitingDetail: true },
  };
}
