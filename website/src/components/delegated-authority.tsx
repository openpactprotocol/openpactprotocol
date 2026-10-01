import {
  ActorBox,
  ArrowMarkers,
  FlowArrow,
  PLATFORM,
  PROVIDER,
  PartBox,
  USER,
  protocolOverviewStyles,
  type Arrow,
  type Part,
} from "./protocol-overview";

const TOP = 72;
const HEIGHT = 400;
const CANVAS_HEIGHT = 490;
const LOGIN_Y = 52;

const arrows: Arrow[] = [
  {
    step: 1,
    label: "Request scopes",
    y: 144,
    from: PLATFORM.x + PLATFORM.width,
    to: PROVIDER.x,
    tone: "consent",
  },
  {
    step: 2,
    label: "Login link",
    y: 192,
    from: PROVIDER.x,
    to: PLATFORM.x + PLATFORM.width,
    tone: "consent",
  },
  {
    step: 3,
    label: "Show link",
    y: 192,
    from: PLATFORM.x,
    to: USER.x + USER.width,
    tone: "consent",
  },
  {
    step: 5,
    label: "Signed scope token",
    y: 252,
    from: PROVIDER.x,
    to: PLATFORM.x + PLATFORM.width,
    tone: "consent",
  },
  {
    step: 6,
    label: "Message + both tokens",
    y: 320,
    from: PLATFORM.x + PLATFORM.width,
    to: PROVIDER.x,
  },
  {
    step: 7,
    label: "Reply + signed receipt",
    y: 424,
    from: PROVIDER.x,
    to: PLATFORM.x + PLATFORM.width,
  },
];

const platformParts: Part[] = [
  { label: "Assistant", detail: "shows the link only", y: 172 },
  { label: "Scope token", detail: "signed · can't be edited", y: 232, consent: true },
  { label: "Receipts", detail: "verify · keep", y: 404 },
];

const providerParts: Part[] = [
  { label: "Brand login + consent", detail: "User ticks scopes", y: 124, consent: true },
  { label: "Token signer", detail: "sub · scope · exp", y: 232, consent: true },
  { label: "Token check", detail: "signature · expiry · grant", y: 300 },
];

const AGENT_Y = 364;
const AGENT_HEIGHT = 96;

function ScopeChip({ y, scope, granted }: { y: number; scope: string; granted: boolean }) {
  const state = granted ? "granted" : "denied";
  return (
    <g>
      <rect
        className={`po-chip po-chip-${state}`}
        x={PROVIDER.x + 24}
        y={y}
        width={PROVIDER.width - 48}
        height={18}
        rx={9}
      />
      <text
        className={`po-chip-text po-chip-text-${state}`}
        x={PROVIDER.x + PROVIDER.width / 2}
        y={y + 12.5}
        textAnchor="middle"
      >
        {granted ? `✓ ${scope}` : `✗ ${scope}`}
      </text>
    </g>
  );
}

export function DelegatedAuthorityDiagram() {
  const boundary = (PLATFORM.x + PLATFORM.width + PROVIDER.x) / 2;
  const userCenter = USER.x + USER.width / 2;
  const loginEnd = PROVIDER.x + 32;
  const lockX = PLATFORM.x + 30;
  const lockY = 246;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={780}
      height={CANVAS_HEIGHT}
      viewBox={`-10 0 780 ${CANVAS_HEIGHT}`}
      role="img"
      aria-labelledby="delegated-authority-title delegated-authority-desc"
      fontFamily='-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
    >
      <style>{protocolOverviewStyles}</style>
      <rect className="po-canvas" x={-10} y={0} width={780} height={CANVAS_HEIGHT} />
      <title id="delegated-authority-title">Delegated authority</title>
      <desc id="delegated-authority-desc">
        The personal agent requests scopes and shows the User a login link. The User logs in with
        the Brand and approves scopes directly with the Provider; the personal agent never sees the
        login. The Provider signs a scope token that the personal agent carries but cannot edit. On
        each message the Provider checks the token, and the Brand&apos;s agent can only use the
        approved scopes. Every reply carries a signed receipt.
      </desc>
      <ArrowMarkers />

      <rect
        className="po-zone"
        x={-8}
        y={4}
        width={boundary + 8}
        height={CANVAS_HEIGHT - 8}
        rx={14}
      />
      <rect
        className="po-zone po-zone-business"
        x={boundary}
        y={4}
        width={768 - boundary}
        height={CANVAS_HEIGHT - 8}
        rx={14}
      />
      <text className="po-zone-label" x={4} y={24}>
        PERSONAL AGENT SIDE
      </text>
      <text className="po-zone-label" x={boundary + 18} y={24}>
        PROVIDER SIDE
      </text>
      <line className="po-boundary" x1={boundary} y1={34} x2={boundary} y2={CANVAS_HEIGHT - 6} />

      <ActorBox
        x={USER.x}
        width={USER.width}
        title="User"
        subtitle="approves scopes"
        top={TOP}
        height={HEIGHT}
      />
      <ActorBox
        x={PLATFORM.x}
        width={PLATFORM.width}
        title="Personal agent"
        subtitle="carries the token"
        top={TOP}
        height={HEIGHT}
      />
      <ActorBox
        x={PROVIDER.x}
        width={PROVIDER.width}
        title="Provider"
        subtitle="signs and checks it"
        top={TOP}
        height={HEIGHT}
      />

      <g className="po-person" transform={`translate(${userCenter} 270)`}>
        <circle cx={0} cy={-26} r={13} />
        <path d="M -24 18 a 24 24 0 0 1 48 0 z" />
      </g>

      {platformParts.map((part) => (
        <PartBox key={part.label} x={PLATFORM.x} width={PLATFORM.width} part={part} />
      ))}
      {providerParts.map((part) => (
        <PartBox key={part.label} x={PROVIDER.x} width={PROVIDER.width} part={part} />
      ))}

      <g className="po-lock" transform={`translate(${lockX} ${lockY})`}>
        <rect x={-6} y={-2} width={12} height={10} rx={2} />
        <path d="M -3.5 -2 V -5 a 3.5 3.5 0 0 1 7 0 V -2" />
      </g>

      <line
        className="po-internal po-arrow-consent"
        x1={PROVIDER.x + PROVIDER.width / 2}
        y1={168}
        x2={PROVIDER.x + PROVIDER.width / 2}
        y2={226}
        markerEnd="url(#po-head-optional)"
      />
      <line
        className="po-internal"
        x1={PROVIDER.x + PROVIDER.width / 2}
        y1={344}
        x2={PROVIDER.x + PROVIDER.width / 2}
        y2={AGENT_Y - 6}
        markerEnd="url(#po-head)"
      />

      <rect
        className="po-part po-part-accent"
        x={PROVIDER.x + 12}
        y={AGENT_Y}
        width={PROVIDER.width - 24}
        height={AGENT_HEIGHT}
        rx={8}
      />
      <text
        className="po-part-label"
        x={PROVIDER.x + PROVIDER.width / 2}
        y={AGENT_Y + 18}
        textAnchor="middle"
      >
        Brand&apos;s agent
      </text>
      <text
        className="po-part-detail"
        x={PROVIDER.x + PROVIDER.width / 2}
        y={AGENT_Y + 32}
        textAnchor="middle"
      >
        acts as the User
      </text>
      <ScopeChip y={AGENT_Y + 44} scope="orders:read" granted />
      <ScopeChip y={AGENT_Y + 68} scope="orders:cancel" granted={false} />

      <path
        className="po-arrow po-arrow-consent"
        d={`M ${userCenter} ${TOP - 4} V ${LOGIN_Y} H ${loginEnd} V ${TOP - 6}`}
        fill="none"
        markerEnd="url(#po-head-optional)"
      />
      <text
        className="po-arrow-label"
        x={PLATFORM.x + PLATFORM.width / 2}
        y={LOGIN_Y - 13}
        textAnchor="middle"
      >
        Log in with the Brand, approve scopes
      </text>
      <circle
        className="po-step po-step-optional"
        cx={PLATFORM.x + PLATFORM.width / 2}
        cy={LOGIN_Y}
        r={9}
      />
      <text
        className="po-step-number"
        x={PLATFORM.x + PLATFORM.width / 2}
        y={LOGIN_Y + 3.5}
        textAnchor="middle"
      >
        4
      </text>

      {arrows.map((arrow) => (
        <FlowArrow key={arrow.step} arrow={arrow} />
      ))}
    </svg>
  );
}

export function DelegatedAuthority() {
  return (
    <figure className="protocol-overview">
      <div className="protocol-overview-canvas">
        <DelegatedAuthorityDiagram />
      </div>
      <figcaption>
        <span className="po-legend po-legend-consent">Getting a token (once per grant)</span>
        <span className="po-legend po-legend-runtime">Every delegated turn</span>
        <span className="po-legend-note">Numbers match the steps below.</span>
      </figcaption>
    </figure>
  );
}
