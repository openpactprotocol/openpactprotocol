import { flightRebookAuthorizations } from "../../../../brand/src/authorization.js";
import type { AuthorizationDetails } from "@openpactprotocol/protocol/delegation";
import type { ScopeDefinition } from "../config.js";

function scopeIcon(scope: ScopeDefinition): string {
  return scope.writes
    ? "writes"
    : (["history", "upcoming"].find((name) => scope.id.includes(name)) ?? "default");
}

export function ConsentPage({
  brandName,
  providerName,
  agent,
  platformOrigin,
  email,
  scopes,
  authorizationDetails,
  action,
  session,
}: {
  brandName: string;
  providerName: string;
  agent: string;
  platformOrigin: string;
  email: string;
  scopes: (ScopeDefinition & { requested: boolean })[];
  authorizationDetails?: AuthorizationDetails | undefined;
  action: string;
  session: string;
}) {
  const requested = scopes.filter((scope) => scope.requested);

  return (
    <>
      <div className="brand">
        <span className="logo">{brandName.charAt(0)}</span>
        {brandName}
      </div>
      <div className="link" aria-hidden="true">
        <span className="pa">✦</span>
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        <span className="logo">{brandName.charAt(0)}</span>
      </div>
      <h1>
        {agent} wants to access your {brandName} account
      </h1>
      <p className="sub">
        Signed in as <b>{email}</b>
        <br />
        Agent from {platformOrigin}
      </p>
      <form method="post" action={action} id="consent">
        <input type="hidden" name="session" value={session} />
        <div className="label">It will be able to</div>
        <div className="scopes">
          {requested.map((scope) => (
            <label className="scope" title={scope.id} key={scope.id}>
              <span className="icon" aria-hidden="true">
                <span className={`glyph glyph-${scopeIcon(scope)}`} />
              </span>
              <span className="scope-body">
                <span className="scope-title">
                  {scope.description}
                  {scope.writes && <span className="badge">Makes changes</span>}
                </span>
                <span className="scope-detail">{scope.detail}</span>
                {scope.id === "flights:rebook" &&
                  authorizationDetails &&
                  flightRebookAuthorizations(authorizationDetails).map((detail) => (
                    <span
                      className="scope-detail"
                      key={`${detail.identifier}:${detail.target_flight}`}
                    >
                      Only reservation {detail.identifier}, to flight {detail.target_flight}
                    </span>
                  ))}
              </span>
              <span className="toggle">
                <input
                  type="checkbox"
                  name="scope"
                  value={scope.id}
                  aria-label={scope.description}
                  defaultChecked
                />
                <span />
              </span>
            </label>
          ))}
        </div>
        <div className="actions">
          <button className="allow" type="submit" name="decision" value="allow" id="allow">
            Allow {requested.length} of {requested.length}
          </button>
          <button className="deny" type="submit" name="decision" value="deny">
            Don&apos;t allow
          </button>
        </div>
      </form>
      <details>
        <summary>Scope IDs</summary>
        {requested.map((scope) => (
          <code key={scope.id}>{scope.id}</code>
        ))}
      </details>
      <p className="foot">
        {agent} never sees your password. Revoke access anytime in {brandName} settings. Powered by{" "}
        {providerName}.
      </p>
    </>
  );
}
