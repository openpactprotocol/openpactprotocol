export type Arrow = {
  step?: number;
  label: string;
  y: number;
  from: number;
  to: number;
  tone?: "setup" | "consent";
};

export const USER = { x: 0, width: 116 };
export const PLATFORM = { x: 244, width: 184 };
export const PROVIDER = { x: 568, width: 192 };
const TOP = 56;
const HEIGHT = 348;

const arrows: Arrow[] = [
  {
    step: 1,
    label: "Onboard (once)",
    y: 126,
    from: PLATFORM.x + PLATFORM.width,
    to: PROVIDER.x,
    tone: "setup",
  },
  { label: "Ask", y: 178, from: USER.x + USER.width, to: PLATFORM.x },
  {
    step: 2,
    label: "Get Agent Card",
    y: 178,
    from: PLATFORM.x + PLATFORM.width,
    to: PROVIDER.x,
  },
  {
    step: 3,
    label: "Message + token",
    y: 236,
    from: PLATFORM.x + PLATFORM.width,
    to: PROVIDER.x,
  },
  {
    step: 4,
    label: "Fetch keys, verify",
    y: 294,
    from: PROVIDER.x,
    to: PLATFORM.x + PLATFORM.width,
  },
  {
    step: 5,
    label: "Reply + contextId",
    y: 362,
    from: PROVIDER.x,
    to: PLATFORM.x + PLATFORM.width,
  },
  { label: "Answer", y: 362, from: PLATFORM.x, to: USER.x + USER.width },
];

export type Part = {
  label: string;
  detail: string;
  y: number;
  accent?: boolean;
  consent?: boolean;
};

const platformParts: Part[] = [
  { label: "Assistant", detail: "talks to the User", y: 158 },
  { label: "Signing key", detail: "private, server-only", y: 216 },
  { label: "Public keys", detail: "/.well-known/jwks.json", y: 274 },
];

const providerParts: Part[] = [
  { label: "Onboarded agents", detail: "issuer · keys URL · audience", y: 106 },
  { label: "Agent Card", detail: "/a2a/{brandId}", y: 158 },
  { label: "Token check", detail: "signature · issuer · audience", y: 216 },
  { label: "Brand's agent", detail: "one conversation per User", y: 318, accent: true },
];

export function ActorBox({
  x,
  width,
  title,
  subtitle,
  top = TOP,
  height = HEIGHT,
}: {
  x: number;
  width: number;
  title: string;
  subtitle: string;
  top?: number;
  height?: number;
}) {
  return (
    <g>
      <rect className="po-actor" x={x} y={top} width={width} height={height} rx={12} />
      <text className="po-actor-title" x={x + width / 2} y={top + 22} textAnchor="middle">
        {title}
      </text>
      <text className="po-actor-subtitle" x={x + width / 2} y={top + 37} textAnchor="middle">
        {subtitle}
      </text>
    </g>
  );
}

export function PartBox({ x, width, part }: { x: number; width: number; part: Part }) {
  const height = part.accent ? 60 : 40;
  const className = part.accent
    ? "po-part po-part-accent"
    : part.consent
      ? "po-part po-part-consent"
      : "po-part";
  return (
    <g>
      <rect className={className} x={x + 12} y={part.y} width={width - 24} height={height} rx={8} />
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

const arrowClass = { setup: "po-arrow-setup", consent: "po-arrow-consent" };
const headId = { setup: "po-head-setup", consent: "po-head-optional" };
const stepClass = { setup: "po-step-setup", consent: "po-step-optional" };

export function FlowArrow({ arrow }: { arrow: Arrow }) {
  const direction = arrow.to > arrow.from ? 1 : -1;
  const start = arrow.from + direction * 4;
  const end = arrow.to - direction * 4;
  const middle = (arrow.from + arrow.to) / 2;
  return (
    <g>
      <line
        className={arrow.tone ? `po-arrow ${arrowClass[arrow.tone]}` : "po-arrow"}
        x1={start}
        y1={arrow.y}
        x2={end}
        y2={arrow.y}
        markerEnd={`url(#${arrow.tone ? headId[arrow.tone] : "po-head"})`}
      />
      <text className="po-arrow-label" x={middle} y={arrow.y - 15} textAnchor="middle">
        {arrow.label}
      </text>
      {arrow.step === undefined ? null : (
        <>
          <circle
            className={arrow.tone ? `po-step ${stepClass[arrow.tone]}` : "po-step"}
            cx={middle}
            cy={arrow.y}
            r={9}
          />
          <text className="po-step-number" x={middle} y={arrow.y + 3.5} textAnchor="middle">
            {arrow.step}
          </text>
        </>
      )}
    </g>
  );
}

export function ArrowMarkers() {
  return (
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
  );
}

export const protocolOverviewStyles = `
.po-canvas {
  fill: #ffffff;
}

.po-zone {
  fill: #f7f7ff;
}

.po-zone-business {
  fill: #f6f8fa;
}

.po-zone-label {
  fill: #9aa1ad;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
}

.po-boundary {
  stroke: #c3c8d2;
  stroke-dasharray: 3 4;
}

.po-actor {
  fill: #ffffff;
  stroke: #d4d8df;
}

.po-actor-title {
  fill: #111827;
  font-size: 13px;
  font-weight: 650;
}

.po-actor-subtitle {
  fill: #6b7280;
  font-size: 10.5px;
}

.po-part {
  fill: #fafbfc;
  stroke: #e3e6eb;
}

.po-part-accent {
  fill: #eef2ff;
  stroke: #c7caff;
}

.po-part-label {
  fill: #303847;
  font-size: 11.5px;
  font-weight: 620;
}

.po-part-detail {
  fill: #7b8390;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
}

.po-person {
  fill: #d9dcf8;
}

.po-arrow,
.po-internal {
  stroke: #4f46e5;
  stroke-width: 1.6;
}

.po-internal {
  stroke-width: 1.2;
}

.po-arrow-setup {
  stroke: #8a92a0;
  stroke-dasharray: 5 4;
}

.po-arrow-consent {
  stroke: #b45309;
}

.po-part-consent {
  fill: #fff7ed;
  stroke: #fdba74;
}

.po-lock {
  fill: none;
  stroke: #b45309;
  stroke-width: 1.4;
}

.po-chip {
  stroke-width: 1;
}

.po-chip-granted {
  fill: #ecfdf5;
  stroke: #a7f3d0;
}

.po-chip-denied {
  fill: #f9fafb;
  stroke: #d1d5db;
  stroke-dasharray: 3 2;
}

.po-chip-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
}

.po-chip-text-granted {
  fill: #047857;
}

.po-chip-text-denied {
  fill: #9ca3af;
}

.po-arrow-optional {
  stroke: #b45309;
  stroke-dasharray: 2 4;
  stroke-linecap: round;
}

.po-head-optional {
  fill: #b45309;
}

.po-step.po-step-optional {
  fill: #b45309;
}

.po-head {
  fill: #4f46e5;
}

.po-head-setup {
  fill: #8a92a0;
}

.po-arrow-label {
  fill: #303847;
  font-size: 11.5px;
  font-weight: 560;
  paint-order: stroke;
  stroke: #fbfbff;
  stroke-width: 4px;
  stroke-linejoin: round;
}

.po-step {
  fill: #4f46e5;
  stroke: #ffffff;
  stroke-width: 2;
}

.po-step-setup {
  fill: #8a92a0;
}

.po-step-number {
  fill: white;
  font-size: 10px;
  font-weight: 750;
}
`;

export function ProtocolOverviewDiagram() {
  const boundary = (PLATFORM.x + PLATFORM.width + PROVIDER.x) / 2;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={780}
      height={482}
      viewBox="-10 0 780 482"
      role="img"
      aria-labelledby="protocol-overview-title protocol-overview-desc"
      fontFamily='-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
    >
      <style>{protocolOverviewStyles}</style>
      <rect className="po-canvas" x={-10} y={0} width={780} height={482} />
      <title id="protocol-overview-title">PACT at a glance</title>
      <desc id="protocol-overview-desc">
        The User asks their personal agent for help. The personal agent, onboarded once with the
        Provider, reads the Brand&apos;s Agent Card and sends a message signed with its own key. The
        Provider verifies the JWT against the personal agent&apos;s public keys, the Brand&apos;s
        agent replies with a contextId, and the personal agent relays the answer. Optionally, the
        User logs in with the Brand and approves scopes so the agent can act on their account.
      </desc>
      <ArrowMarkers />

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
        PERSONAL AGENT SIDE
      </text>
      <text className="po-zone-label" x={boundary + 18} y={30}>
        PROVIDER SIDE
      </text>
      <line className="po-boundary" x1={boundary} y1={40} x2={boundary} y2={472} />

      <ActorBox x={USER.x} width={USER.width} title="User" subtitle="anonymous id" />
      <ActorBox
        x={PLATFORM.x}
        width={PLATFORM.width}
        title="Personal agent"
        subtitle="acts for the User"
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
        Authorize (optional): User logs in with the Brand, approves scopes (spec §5)
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
        <FlowArrow key={arrow.label} arrow={arrow} />
      ))}
    </svg>
  );
}

export function ProtocolOverview() {
  return (
    <figure className="protocol-overview">
      <div className="protocol-overview-canvas">
        <ProtocolOverviewDiagram />
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
