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

export type Part = {
  label: string;
  detail: string;
  y: number;
  accent?: boolean;
  consent?: boolean;
};

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

.po-lane {
  stroke: #e5e7eb;
  stroke-width: 1.2;
}

.po-column {
  stroke: #e5e7eb;
  stroke-width: 1.2;
  stroke-dasharray: 2 4;
}

.po-lane-title {
  fill: #111827;
  font-size: 15px;
  font-weight: 700;
}

.po-lane-note {
  fill: #6b7280;
  font-size: 12px;
}

.po-index {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 700;
}

.po-index-trust {
  fill: #4f46e5;
}

.po-index-consent {
  fill: #b45309;
}

.po-column-title {
  fill: #111827;
  font-size: 15px;
  font-weight: 700;
}

.po-pill {
  fill: #ffffff;
  stroke-width: 1.4;
}

.po-pill-trust {
  stroke: #a5b4fc;
}

.po-pill-consent {
  stroke: #fdba74;
}

.po-pill-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.po-pill-text-trust {
  fill: #4f46e5;
}

.po-pill-text-consent {
  fill: #b45309;
}

.po-flow {
  stroke-width: 1.7;
}

.po-flow-trust {
  stroke: #4f46e5;
}

.po-flow-consent {
  stroke: #b45309;
}

.po-flow-dashed {
  stroke-dasharray: 3 4;
}

.po-description {
  fill: #6b7280;
  font-size: 12.5px;
}
`;

type Tone = "trust" | "consent";

type Column = {
  index: string;
  title: string[];
  tone: Tone;
  pill: string;
  pillWidth: number;
  direction: "up" | "down" | "both";
  description: string[];
};

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

const WIDTH = 1024;
const CANVAS = 488;
const LANES_X = 156;
const LANES_END = 1006;
const COLUMN_WIDTH = (LANES_END - LANES_X) / columns.length;
const USER_LANE = 148;
const AGENT_LANE = 252;
const BRAND_LANE = 356;
const PILL_HEIGHT = 24;

const headFor: Record<Tone, string> = { trust: "po-head", consent: "po-head-optional" };

function Pill({
  x,
  y,
  width,
  label,
  tone,
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  tone: Tone;
}) {
  return (
    <g>
      <rect
        className={`po-pill po-pill-${tone}`}
        x={x - width / 2}
        y={y - PILL_HEIGHT / 2}
        width={width}
        height={PILL_HEIGHT}
        rx={PILL_HEIGHT / 2}
      />
      <text className={`po-pill-text po-pill-text-${tone}`} x={x} y={y + 4} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function Lines({
  className,
  x,
  y,
  lines,
  lineHeight,
}: {
  className: string;
  x: number;
  y: number;
  lines: string[];
  lineHeight: number;
}) {
  return (
    <text className={className} x={x} y={y}>
      {lines.map((line, i) => (
        <tspan key={line} x={x} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function Exchange({ column, x }: { column: Column; x: number }) {
  const pillY = (AGENT_LANE + BRAND_LANE) / 2;
  const top = AGENT_LANE + 10;
  const bottom = BRAND_LANE - 10;
  const head = `url(#${headFor[column.tone]})`;
  const upward = column.direction !== "down";
  const downward = column.direction !== "up";
  return (
    <g>
      <line
        className={`po-flow po-flow-${column.tone}`}
        x1={x}
        y1={upward ? top : top - 2}
        x2={x}
        y2={downward ? bottom : bottom + 2}
        markerStart={upward ? head : undefined}
        markerEnd={downward ? head : undefined}
      />
      <Pill x={x} y={pillY} width={column.pillWidth} label={column.pill} tone={column.tone} />
    </g>
  );
}

export function ProtocolOverviewDiagram() {
  const signInX = LANES_X + COLUMN_WIDTH * 2.5;
  const signInY = (USER_LANE + AGENT_LANE) / 2;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={WIDTH}
      height={CANVAS}
      viewBox={`0 0 ${WIDTH} ${CANVAS}`}
      role="img"
      aria-labelledby="protocol-overview-title protocol-overview-desc"
      fontFamily='-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
    >
      <style>{protocolOverviewStyles}</style>
      <rect className="po-canvas" x={0} y={0} width={WIDTH} height={CANVAS} rx={16} />
      <title id="protocol-overview-title">PACT at a glance</title>
      <desc id="protocol-overview-desc">
        Five steps across three lanes: the User, the personal agent acting for the User, and the
        Brand&apos;s agent hosted by a Provider. The personal agent reads the Brand&apos;s Agent
        Card (discovery) and signs each request with its own key (signed request). Optionally, the
        User signs in on the Brand&apos;s own login page and approves scopes (consent without
        credentials); the agent receives a scoped, short-lived delegation token and sends it with
        its JWT so the Brand&apos;s agent can act for the User within the granted scopes.
      </desc>
      <ArrowMarkers />

      {[USER_LANE, AGENT_LANE, BRAND_LANE].map((y) => (
        <line key={y} className="po-lane" x1={LANES_X} y1={y} x2={LANES_END} y2={y} />
      ))}
      {columns.slice(1).map((column, i) => {
        const x = LANES_X + COLUMN_WIDTH * (i + 1);
        return (
          <line key={column.index} className="po-column" x1={x} y1={36} x2={x} y2={CANVAS - 22} />
        );
      })}

      <g className="po-person" transform="translate(36 146)">
        <circle cx={0} cy={-9} r={7} />
        <path d="M -13 11 a 13 13 0 0 1 26 0 z" />
      </g>
      <text className="po-lane-title" x={58} y={USER_LANE + 5}>
        User
      </text>
      <text className="po-lane-title" x={18} y={AGENT_LANE + 5}>
        Personal agent
      </text>
      <text className="po-lane-note" x={18} y={AGENT_LANE + 24}>
        acts for the User
      </text>
      <text className="po-lane-title" x={18} y={BRAND_LANE + 5}>
        Brand&apos;s agent
      </text>
      <Lines
        className="po-lane-note"
        x={18}
        y={BRAND_LANE + 24}
        lines={["hosted by a Provider", "defines the scopes"]}
        lineHeight={16}
      />

      {columns.map((column, i) => {
        const left = LANES_X + COLUMN_WIDTH * i + 12;
        const center = LANES_X + COLUMN_WIDTH * (i + 0.5);
        return (
          <g key={column.index}>
            <text className={`po-index po-index-${column.tone}`} x={left} y={46}>
              {column.index}
            </text>
            <Lines
              className="po-column-title"
              x={left}
              y={67}
              lines={column.title}
              lineHeight={19}
            />
            <Exchange column={column} x={center} />
            <Lines
              className="po-description"
              x={left}
              y={BRAND_LANE + 40}
              lines={column.description}
              lineHeight={16.5}
            />
          </g>
        );
      })}

      <line
        className="po-flow po-flow-consent po-flow-dashed"
        x1={signInX}
        y1={AGENT_LANE + 10}
        x2={signInX}
        y2={signInY + PILL_HEIGHT / 2 + 4}
      />
      <line
        className="po-flow po-flow-consent"
        x1={signInX}
        y1={signInY - PILL_HEIGHT / 2 - 4}
        x2={signInX}
        y2={USER_LANE + 12}
        markerEnd="url(#po-head-optional)"
      />
      <Pill x={signInX} y={signInY} width={122} label="Brand sign-in" tone="consent" />
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
        <span className="po-legend po-legend-runtime">Trust: every conversation</span>
        <span className="po-legend po-legend-consent">Consent: optional, delegated authority</span>
        <span className="po-legend-note">Numbers match the steps below.</span>
      </figcaption>
    </figure>
  );
}
