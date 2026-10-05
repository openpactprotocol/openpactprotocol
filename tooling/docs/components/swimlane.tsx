export type Tone = "trust" | "consent";

export type Column = {
  index: string;
  title: string[];
  tone: Tone;
  pill: string;
  pillWidth: number;
  direction: "up" | "down" | "both";
  /** An exchange between the User and the personal agent; `through` continues the lower arrow. */
  userLane?: { pill: string; pillWidth: number; through?: boolean };
  description: string[];
};

export const WIDTH = 1024;
export const CANVAS = 488;
const LANES_X = 156;
const LANES_END = 1006;
const USER_LANE = 148;
const AGENT_LANE = 252;
const BRAND_LANE = 356;
const PILL_HEIGHT = 24;

export const swimlaneStyles = `
.po-canvas {
  fill: #ffffff;
}

.po-person {
  fill: #d9dcf8;
}

.po-head {
  fill: #4f46e5;
}

.po-head-optional {
  fill: #b45309;
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

const headFor: Record<Tone, string> = { trust: "po-head", consent: "po-head-optional" };

export function ArrowMarkers() {
  return (
    <defs>
      {Object.values(headFor).map((id) => (
        <marker
          key={id}
          id={id}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className={id} />
        </marker>
      ))}
    </defs>
  );
}

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

function UserExchange({ column, x }: { column: Column; x: number }) {
  if (!column.userLane) return null;
  const { pill, pillWidth, through } = column.userLane;
  const pillY = (USER_LANE + AGENT_LANE) / 2;
  return (
    <g>
      <line
        className={`po-flow po-flow-${column.tone}${through ? " po-flow-dashed" : ""}`}
        x1={x}
        y1={AGENT_LANE + (through ? 10 : -10)}
        x2={x}
        y2={pillY + PILL_HEIGHT / 2 + 4}
      />
      <line
        className={`po-flow po-flow-${column.tone}`}
        x1={x}
        y1={pillY - PILL_HEIGHT / 2 - 4}
        x2={x}
        y2={USER_LANE + 12}
        markerEnd={`url(#${headFor[column.tone]})`}
      />
      <Pill x={x} y={pillY} width={pillWidth} label={pill} tone={column.tone} />
    </g>
  );
}

export function Swimlane({
  id,
  title,
  description,
  columns,
}: {
  id: string;
  title: string;
  description: string;
  columns: Column[];
}) {
  const columnWidth = (LANES_END - LANES_X) / columns.length;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={WIDTH}
      height={CANVAS}
      viewBox={`0 0 ${WIDTH} ${CANVAS}`}
      role="img"
      aria-labelledby={`${id}-title ${id}-desc`}
      fontFamily='-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
    >
      <style>{swimlaneStyles}</style>
      <rect className="po-canvas" x={0} y={0} width={WIDTH} height={CANVAS} rx={16} />
      <title id={`${id}-title`}>{title}</title>
      <desc id={`${id}-desc`}>{description}</desc>
      <ArrowMarkers />

      {[USER_LANE, AGENT_LANE, BRAND_LANE].map((y) => (
        <line key={y} className="po-lane" x1={LANES_X} y1={y} x2={LANES_END} y2={y} />
      ))}
      {columns.slice(1).map((column, i) => {
        const x = LANES_X + columnWidth * (i + 1);
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
        const left = LANES_X + columnWidth * i + 12;
        const center = LANES_X + columnWidth * (i + 0.5);
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
            <UserExchange column={column} x={center} />
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
    </svg>
  );
}
