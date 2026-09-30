export function getProviderBaseUrl(request: Request): string {
  const base =
    process.env.PROVIDER_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : new URL(request.url).origin);
  return base.replace(/\/+$/, "");
}
