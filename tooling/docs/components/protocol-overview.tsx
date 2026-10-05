import { Swimlane, type Column } from "./swimlane";

const columns: Column[] = [
  {
    index: "01",
    title: ["Discovery"],
    tone: "trust",
    pill: "agent card",
    pillWidth: 98,
    direction: "both",
    description: [
      "The personal agent reads",
      "the Brand's Agent Card,",
      "which publishes the",
      "Brand's own scopes",
      "(e.g., orders:read,",
      "orders:cancel).",
    ],
  },
  {
    index: "02",
    title: ["Signed request"],
    tone: "trust",
    pill: "message + JWT",
    pillWidth: 122,
    direction: "down",
    description: [
      "The personal agent signs",
      "requests with its own",
      "key, so the Brand can",
      "verify the agent it's",
      "talking to.",
    ],
  },
  {
    index: "03",
    title: ["Consent without", "credentials"],
    tone: "consent",
    pill: "approve scopes",
    pillWidth: 130,
    direction: "both",
    userLane: { pill: "Brand sign-in", pillWidth: 122, through: true },
    description: [
      "The User signs in on the",
      "Brand's own login page,",
      "never with the agent,",
      "then approves each scope",
      "individually.",
    ],
  },
  {
    index: "04",
    title: ["Scoped,", "short-lived token"],
    tone: "consent",
    pill: "delegation token",
    pillWidth: 146,
    direction: "up",
    description: [
      "The agent receives a",
      "token naming the User,",
      "the agent, the Brand,",
      "and the granted scopes.",
    ],
  },
  {
    index: "05",
    title: ["Act for the User"],
    tone: "consent",
    pill: "JWT + token",
    pillWidth: 106,
    direction: "both",
    description: [
      "The agent sends the",
      "token with its JWT; the",
      "Brand's agent acts on",
      "the User's account",
      "within the granted",
      "scopes.",
    ],
  },
];

export function ProtocolOverviewDiagram() {
  return (
    <Swimlane
      id="protocol-overview"
      title="PACT at a glance"
      description="Five steps across three lanes: the User, the personal agent acting for the User, and the Brand's agent hosted by a Provider. The personal agent reads the Brand's Agent Card (discovery) and signs each request with its own key (signed request). Optionally, the User signs in on the Brand's own login page and approves scopes (consent without credentials); the agent receives a scoped, short-lived delegation token and sends it with its JWT so the Brand's agent can act for the User within the granted scopes."
      columns={columns}
    />
  );
}
