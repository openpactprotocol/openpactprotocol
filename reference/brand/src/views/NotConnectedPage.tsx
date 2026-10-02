import { BrandHeader } from "./BrandHeader.js";

export function NotConnectedPage({ client }: { client: string }) {
  return (
    <>
      <BrandHeader />
      <div className="status no">
        <span className="glyph glyph-cross" aria-hidden="true" />
      </div>
      <h1>Not connected</h1>
      <p className="sub">
        <b>{client}</b> can&apos;t access your Skyline account. You can close this tab.
      </p>
    </>
  );
}
