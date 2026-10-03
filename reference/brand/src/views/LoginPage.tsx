import { BrandHeader } from "./BrandHeader.js";

export function LoginPage({
  returnTo,
  userCode,
  email,
  error,
}: {
  returnTo: string;
  userCode: string | null;
  email?: string;
  error?: string;
}) {
  return (
    <>
      <BrandHeader />
      <h1>Sign in to Skyline Airways</h1>
      <p className="sub">to connect your personal agent</p>
      <form method="post" action="/login">
        {error && <div className="error">{error}</div>}
        <input type="hidden" name="return_to" value={returnTo} />
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={email ?? "alex.rivera@example.com"}
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {userCode ? (
          <input type="hidden" name="user_code" value={userCode} />
        ) : (
          <>
            <label htmlFor="user_code">Code from your agent</label>
            <input id="user_code" name="user_code" placeholder="ABCD-EFGH" required />
          </>
        )}
        <button type="submit">Sign in</button>
      </form>
      <p className="hint">
        Demo account: <code>alex.rivera@example.com</code> / <code>skyline</code>
      </p>
    </>
  );
}
