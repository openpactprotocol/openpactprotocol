import { BrandHeader } from "./BrandHeader.js";

export function ConnectedPage({ client, labels }: { client: string; labels: string[] }) {
  return (
    <>
      <BrandHeader />
      <div className="status ok">
        <span className="glyph glyph-check" aria-hidden="true" />
      </div>
      <h1>You&apos;re connected</h1>
      <p className="sub">
        <b>{client}</b> can now help with your Skyline account.
      </p>
      <div className="label">Access you shared</div>
      <ul className="granted">
        {labels.map((label) => (
          <li key={label}>
            <span className="glyph glyph-check" aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
      <p className="foot">
        You can close this tab and go back to your agent. Manage or revoke access anytime in Skyline
        settings.
      </p>
    </>
  );
}
