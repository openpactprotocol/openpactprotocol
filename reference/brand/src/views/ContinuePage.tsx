import { BrandHeader } from "./BrandHeader.js";

export function ContinuePage({
  action,
  assertion,
  email,
}: {
  action: string;
  assertion: string;
  email: string;
}) {
  return (
    <>
      <BrandHeader />
      <form method="post" action={action}>
        <input type="hidden" name="assertion" value={assertion} />
        <p className="sub spaced">
          Signed in as <b>{email}</b>. Continuing…
        </p>
        <noscript>
          <button type="submit">Continue</button>
        </noscript>
      </form>
    </>
  );
}
