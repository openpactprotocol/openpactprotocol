import { Swimlane, type Column } from "./swimlane";

const columns: Column[] = [
  {
    index: "01",
    title: ["Request scopes"],
    tone: "consent",
    pill: "scopes",
    pillWidth: 74,
    direction: "down",
    description: [
      "The personal agent asks",
      "the Provider for the",
      "scopes it needs, with",
      "its JWT as the client",
      "credential (§5.3).",
    ],
  },
  {
    index: "02",
    title: ["Login link"],
    tone: "consent",
    pill: "login link",
    pillWidth: 98,
    direction: "up",
    userLane: { pill: "show link", pillWidth: 92 },
    description: [
      "The Provider returns a",
      "link to the Brand's own",
      "login. The personal agent",
      "only shows it; it never",
      "handles the login.",
    ],
  },
  {
    index: "03",
    title: ["Sign in and", "approve"],
    tone: "consent",
    pill: "approve scopes",
    pillWidth: 130,
    direction: "both",
    userLane: { pill: "Brand sign-in", pillWidth: 122, through: true },
    description: [
      "The User logs in with the",
      "Brand and ticks scopes on",
      "the Provider's consent",
      "page. The personal agent",
      "never sees the login.",
    ],
  },
  {
    index: "04",
    title: ["Delegation token"],
    tone: "consent",
    pill: "delegation token",
    pillWidth: 146,
    direction: "up",
    description: [
      "The Provider signs a",
      "token listing the",
      "approved scopes (§5.4).",
      "The personal agent",
      "carries it but cannot",
      "change it.",
    ],
  },
  {
    index: "05",
    title: ["Send and receipt"],
    tone: "trust",
    pill: "JWT + token",
    pillWidth: 106,
    direction: "both",
    description: [
      "Each message carries",
      "both tokens; the Brand's",
      "agent acts as the User",
      "only within those scopes",
      "(§5.5). Every reply has",
      "a signed receipt (§5.6).",
    ],
  },
];

export function DelegatedAuthorityDiagram() {
  return (
    <Swimlane
      id="delegated-authority"
      title="Delegated authority"
      description="The personal agent requests scopes and shows the User a login link. The User logs in with the Brand and approves scopes directly with the Provider; the personal agent never sees the login. The Provider signs a delegation token that the personal agent carries but cannot edit. On each message the Provider checks the token, and the Brand's agent can only use the approved scopes. Every reply carries a signed receipt."
      columns={columns}
    />
  );
}

export function DelegatedAuthority() {
  return (
    <figure className="protocol-overview">
      <div className="protocol-overview-canvas">
        <DelegatedAuthorityDiagram />
      </div>
      <figcaption>
        <span className="po-legend po-legend-consent">Once per grant</span>
        <span className="po-legend po-legend-runtime">Every delegated turn</span>
        <span className="po-legend-note">Numbers match the steps below.</span>
      </figcaption>
    </figure>
  );
}
