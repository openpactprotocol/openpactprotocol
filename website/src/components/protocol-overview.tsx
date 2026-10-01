type Arrow = {
  step: number;
  label: string;
  y: number;
  from: number;
  to: number;
  setup?: boolean;
};

const USER = { x: 0, width: 116 };
const PLATFORM = { x: 244, width: 184 };
const PROVIDER = { x: 568, width: 192 };
const TOP = 56;
const HEIGHT = 348;

const arrows: Arrow[] = [
  {
    step: 1,
    label: "Onboard (once)",
    y: 126,
    from: PLATFORM.x + PLATFORM.width,
    to: PROVIDER.x,
    setup: true,
  },
  { step: 2, label: "Ask", y: 178, from: USER.x + USER.width, to: PLATFORM.x },
  {
    step: 3,
    label: "Get Agent Card",
    y: 178,
    from: PLATFORM.x + PLATFORM.width,
    to: PROVIDER.x,
  },
  {
    step: 4,
    label: "message:send + JWT",
    y: 236,
    from: PLATFORM.x + PLATFORM.width,
    to: PROVIDER.x,
  },
  {
    step: 5,
    label: "Fetch JWKS, verify",
    y: 294,
    from: PROVIDER.x,
    to: PLATFORM.x + PLATFORM.width,
  },
  {
    step: 6,
    label: "Reply + contextId",
    y: 362,
    from: PROVIDER.x,
    to: PLATFORM.x + PLATFORM.width,
  },
  { step: 7, label: "Answer", y: 362, from: PLATFORM.x, to: USER.x + USER.width },
];

type Part = { label: string; detail: string; y: number; accent?: boolean };

const platformParts: Part[] = [
  { label: "Assistant", detail: "talks to the User", y: 158 },
  { label: "Signing key", detail: "private, server-only", y: 216 },
  { label: "JWKS", detail: "/.well-known/jwks.json", y: 274 },
];

const providerParts: Part[] = [
  { label: "PA registry", detail: "issuer · jwksUri · aud", y: 106 },
  { label: "Agent Card", detail: "/a2a/{brandId}", y: 158 },
  { label: "JWT verification", detail: "iss · sub · aud · exp", y: 216 },
  { label: "Brand's agent", detail: "one contextId per User", y: 318, accent: true },
];

function ActorBox({
  x,
  width,
  title,
  subtitle,
}: {
  x: number;
  width: number;
  title: string;
  subtitle: string;
}) {
  return (
    <g>
      <rect className="po-actor" x={x} y={TOP} width={width} height={HEIGHT} rx={12} />
      <text className="po-actor-title" x={x + width / 2} y={TOP + 22} textAnchor="middle">
        {title}
      </text>
      <text className="po-actor-subtitle" x={x + width / 2} y={TOP + 37} textAnchor="middle">
        {subtitle}
      </text>
    </g>
  );
}

function PartBox({ x, width, part }: { x: number; width: number; part: Part }) {
  const height = part.accent ? 60 : 40;
  return (
    <g>
      <rect
        className={part.accent ? "po-part po-part-accent" : "po-part"}
        x={x + 12}
        y={part.y}
        width={width - 24}
        height={height}
        rx={8}
      />
      <text
        className="po-part-label"
        x={x + width / 2}
        y={part.y + height / 2 - 2}
        textAnchor="middle"
      >
        {part.label}
      </text>
      <text
        className="po-part-detail"
        x={x + width / 2}
        y={part.y + height / 2 + 12}
        textAnchor="middle"
      >
        {part.detail}
      </text>
    </g>
  );
}

function FlowArrow({ arrow }: { arrow: Arrow }) {
  const direction = arrow.to > arrow.from ? 1 : -1;
  const start = arrow.from + direction * 4;
  const end = arrow.to - direction * 4;
  const middle = (arrow.from + arrow.to) / 2;
  return (
    <g>
      <line
        className={arrow.setup ? "po-arrow po-arrow-setup" : "po-arrow"}
        x1={start}
        y1={arrow.y}
        x2={end}
        y2={arrow.y}
        markerEnd={arrow.setup ? "url(#po-head-setup)" : "url(#po-head)"}
      />
      <text className="po-arrow-label" x={middle} y={arrow.y - 15} textAnchor="middle">
        {arrow.label}
      </text>
      <circle
        className={arrow.setup ? "po-step po-step-setup" : "po-step"}
        cx={middle}
        cy={arrow.y}
        r={9}
      />
      <text className="po-step-number" x={middle} y={arrow.y + 3.5} textAnchor="middle">
        {arrow.step}
      </text>
    </g>
  );
}

export function ProtocolOverview() {
  const boundary = (PLATFORM.x + PLATFORM.width + PROVIDER.x) / 2;
  return (
    <figure className="protocol-overview">
      <div className="protocol-overview-canvas">
        <svg
          viewBox="-10 0 780 482"
          role="img"
          aria-labelledby="protocol-overview-title protocol-overview-desc"
        >
          <title id="protocol-overview-title">PACT at a glance</title>
          <desc id="protocol-overview-desc">
            The User asks their personal agent (PA) for help. The PA, onboarded once with the
            Provider, reads the Brand&apos;s Agent Card and sends a message signed with its PA JWT.
            The Provider verifies the JWT against the PA&apos;s JWKS, the Brand&apos;s agent replies
            with a contextId, and the PA relays the answer. Optionally, the User logs in with the
            Brand and approves scopes so the agent can act on their account.
          </desc>
          <defs>
            <marker
              id="po-head"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="po-head" />
            </marker>
            <marker
              id="po-head-setup"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="po-head-setup" />
            </marker>
            <marker
              id="po-head-optional"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="po-head-optional" />
            </marker>
          </defs>

          <rect className="po-zone" x={-8} y={4} width={boundary + 8} height={474} rx={14} />
          <rect
            className="po-zone po-zone-business"
            x={boundary}
            y={4}
            width={768 - boundary}
            height={474}
            rx={14}
          />
          <text className="po-zone-label" x={4} y={30}>
            PA SIDE
          </text>
          <text className="po-zone-label" x={boundary + 18} y={30}>
            PROVIDER SIDE
          </text>
          <line className="po-boundary" x1={boundary} y1={40} x2={boundary} y2={472} />

          <ActorBox x={USER.x} width={USER.width} title="User" subtitle="pseudonymous sub" />
          <ActorBox
            x={PLATFORM.x}
            width={PLATFORM.width}
            title="Personal agent (PA)"
            subtitle="the A2A client"
          />
          <ActorBox
            x={PROVIDER.x}
            width={PROVIDER.width}
            title="Provider"
            subtitle="hosts Brands' agents"
          />

          <g className="po-person" transform={`translate(${USER.x + USER.width / 2} 228)`}>
            <circle cx={0} cy={-26} r={13} />
            <path d="M -24 18 a 24 24 0 0 1 48 0 z" />
          </g>

          {platformParts.map((part) => (
            <PartBox key={part.label} x={PLATFORM.x} width={PLATFORM.width} part={part} />
          ))}
          {providerParts.map((part) => (
            <PartBox key={part.label} x={PROVIDER.x} width={PROVIDER.width} part={part} />
          ))}
          <line
            className="po-internal"
            x1={PROVIDER.x + PROVIDER.width / 2}
            y1={260}
            x2={PROVIDER.x + PROVIDER.width / 2}
            y2={312}
            markerEnd="url(#po-head)"
          />

          <path
            className="po-arrow po-arrow-optional"
            d={`M ${USER.x + USER.width / 2} ${TOP + HEIGHT + 4} V 448 H ${PROVIDER.x + PROVIDER.width / 2} V ${TOP + HEIGHT + 6}`}
            fill="none"
            markerEnd="url(#po-head-optional)"
          />
          <text
            className="po-arrow-label"
            x={PLATFORM.x + PLATFORM.width / 2}
            y={433}
            textAnchor="middle"
          >
            Authorize (optional): User logs in with the Brand, approves scopes
          </text>
          <circle
            className="po-step po-step-optional"
            cx={PLATFORM.x + PLATFORM.width / 2}
            cy={448}
            r={9}
          />
          <text
            className="po-step-number"
            x={PLATFORM.x + PLATFORM.width / 2}
            y={451.5}
            textAnchor="middle"
          >
            A
          </text>

          {arrows.map((arrow) => (
            <FlowArrow key={arrow.step} arrow={arrow} />
          ))}
        </svg>
      </div>
      <figcaption>
        <span className="po-legend po-legend-runtime">Every conversation</span>
        <span className="po-legend po-legend-setup">Once, at setup</span>
        <span className="po-legend po-legend-optional">Optional: delegated authority</span>
        <span className="po-legend-note">Numbers match the steps below.</span>
      </figcaption>
    </figure>
  );
}
