import { createHash } from "node:crypto";
import type { ReceiptAction } from "@openpactprotocol/protocol/delegation";
import type { FlowState } from "../agent/index.js";
import { listPastTrips, listUpcomingTrips, rebookTrip, type Trip } from "./brandApi.js";
import type { DelegationConfig } from "./config.js";

export type Delegation = { token: string; sub: string; scopes: string[] };

export type DelegatedTurn =
  | { kind: "identity" }
  | { kind: "stepUp"; missingScopes: string[]; text: string }
  | {
      kind: "reply";
      text: string;
      flow: FlowState;
      scopesUsed: string[];
      actions: ReceiptAction[];
    };

type Intent = "status" | "upcoming" | "history" | "rebook";

const SCOPES = {
  upcoming: "flights:upcoming:read",
  history: "flights:history:read",
  rebook: "flights:rebook",
} as const;

const REQUIRED: Record<Intent, string[]> = {
  status: [SCOPES.upcoming],
  upcoming: [SCOPES.upcoming],
  history: [SCOPES.history],
  rebook: [SCOPES.upcoming, SCOPES.rebook],
};

const STEP_UP_TEXT: Record<Intent, string> = {
  status: "I need permission to view the customer's upcoming flights.",
  upcoming: "I need permission to view the customer's booking and look for other flights.",
  history: "I need permission to view the customer's past flights.",
  rebook: "I need permission to rebook the customer's flights.",
};

const FLIGHT_NUMBER = /\b([A-Z]{2})\s?(\d{2,4})\b/i;

export function classify(text: string, flow: FlowState): Intent | undefined {
  const affirmative = /^\s*(yes|yeah|yep|sure|ok(ay)?|please|do it|go ahead|book it)\b/i;
  if (
    /\b(switch|move|put|rebook)\s+me\b/i.test(text) ||
    /\b(rebook|re-book)\b/i.test(text) ||
    (flow.offeredFlight !== undefined && affirmative.test(text))
  ) {
    return "rebook";
  }
  if (
    /\b(past|previous|history|recent)\b.*\b(flights?|trips?)\b/i.test(text) ||
    /\breceipts?\b/i.test(text)
  ) {
    return "history";
  }
  if (
    /\b(earlier|later|sooner|alternatives?|other|another)\b.*\b(flights?|options?)\b/i.test(text) ||
    /\b(switch|change)\b.*\b(flights?)\b/i.test(text) ||
    /\bmy\s+(booking|bookings|trips?|seats?|reservations?|itinerary)\b/i.test(text) ||
    /\bupcoming\b/i.test(text)
  ) {
    return "upcoming";
  }
  if (
    /\bflights?\b/i.test(text) &&
    /\b(on time|delay(ed)?|status|depart|leave|land|arriv)/i.test(text)
  ) {
    return "status";
  }
  return undefined;
}

function argsHash(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("base64url");
}

function describeDelay(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours * 2) ? `${hours} hours` : `${minutes} minutes`;
}

function statusText(trip: Trip): string {
  if (trip.status === "delayed") {
    return `${trip.flight} on ${trip.date} is delayed ${describeDelay(trip.delayMinutes)}. It now leaves ${trip.from} at ${trip.departs} and lands at ${trip.to} at ${trip.arrives}.`;
  }
  return `${trip.flight} on ${trip.date} is on time, leaving ${trip.from} at ${trip.departs} and landing at ${trip.to} at ${trip.arrives}.`;
}

// Deterministic Skyline account agent: each intent maps to one Brand API call
// and the scopes it needs. Intents it doesn't recognize stay on the §3 agent.
export async function runDelegatedTurn(input: {
  config: DelegationConfig;
  text: string;
  flow: FlowState;
  delegation: Delegation | undefined;
  fetchImpl?: typeof fetch;
}): Promise<DelegatedTurn> {
  const intent = classify(input.text, input.flow);
  if (!intent) return { kind: "identity" };
  // Without a token, flight status still works the §3 way (confirmation code).
  if (intent === "status" && !input.delegation) return { kind: "identity" };
  const granted = new Set(input.delegation?.scopes ?? []);
  const missingScopes = REQUIRED[intent].filter((scope) => !granted.has(scope));
  if (missingScopes.length > 0 || !input.delegation) {
    return { kind: "stepUp", missingScopes, text: STEP_UP_TEXT[intent] };
  }

  const { brandUrl } = input.config;
  const { token } = input.delegation;
  const fetchImpl = input.fetchImpl;

  if (intent === "history") {
    const { trips } = await listPastTrips(brandUrl, token, fetchImpl);
    const text =
      trips.length === 0
        ? "No past Skyline flights on this account."
        : `Past flights: ${trips.map((trip) => `${trip.flight} ${trip.date}, ${trip.from} to ${trip.to}`).join("; ")}.`;
    return {
      kind: "reply",
      text,
      flow: {},
      scopesUsed: [SCOPES.history],
      actions: [{ tool: "list_past_trips" }],
    };
  }

  const { trips } = await listUpcomingTrips(brandUrl, token, fetchImpl);
  const trip = trips[0];
  if (!trip) {
    return {
      kind: "reply",
      text: "No upcoming Skyline flights on this account.",
      flow: {},
      scopesUsed: [SCOPES.upcoming],
      actions: [{ tool: "list_upcoming_trips" }],
    };
  }

  if (intent === "rebook") {
    const requested = input.text.match(FLIGHT_NUMBER);
    const requestedFlight = requested
      ? `${requested[1]!.toUpperCase()} ${requested[2]}`
      : undefined;
    const target =
      trip.alternatives.find((alternative) => alternative.flight === requestedFlight) ??
      trip.alternatives.find((alternative) => alternative.flight === input.flow.offeredFlight) ??
      trip.alternatives[0];
    if (!target) {
      return {
        kind: "reply",
        text: `There are no other flights to switch ${trip.flight} to.`,
        flow: {},
        scopesUsed: [SCOPES.upcoming],
        actions: [{ tool: "list_upcoming_trips" }],
      };
    }
    const args = { confirmation: trip.confirmation, flight: target.flight };
    const { trip: rebooked } = await rebookTrip(brandUrl, token, args, fetchImpl);
    return {
      kind: "reply",
      text: `Done: booking ${rebooked.confirmation} is now on ${rebooked.flight} ${rebooked.date}, leaving ${rebooked.from} at ${rebooked.departs} and landing at ${rebooked.to} at ${rebooked.arrives}, seat ${rebooked.seat}. No change fee.`,
      flow: {},
      scopesUsed: [SCOPES.upcoming, SCOPES.rebook],
      actions: [{ tool: "list_upcoming_trips" }, { tool: "rebook_trip", argsHash: argsHash(args) }],
    };
  }

  if (intent === "upcoming" && trip.alternatives.length > 0) {
    const alternative = trip.alternatives[0]!;
    return {
      kind: "reply",
      text: `${statusText(trip)} Earlier option: ${alternative.flight} leaves at ${alternative.departs} and lands at ${alternative.arrives}, ${alternative.seatsLeft} seats left, no change fee. Switch to ${alternative.flight}?`,
      flow: { offeredFlight: alternative.flight },
      scopesUsed: [SCOPES.upcoming],
      actions: [{ tool: "list_upcoming_trips" }],
    };
  }

  return {
    kind: "reply",
    text: statusText(trip),
    flow: {},
    scopesUsed: [SCOPES.upcoming],
    actions: [{ tool: "list_upcoming_trips" }],
  };
}
