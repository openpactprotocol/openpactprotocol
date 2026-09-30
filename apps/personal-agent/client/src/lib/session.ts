export const USER_ID_COOKIE = "pap_user_id";

export const USER_ID_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;

export function homePath(input: { providerUrl: string; slug: string; task?: string }): string {
  const params = new URLSearchParams({ providerUrl: input.providerUrl, slug: input.slug });
  if (input.task) params.set("task", input.task);
  return `/?${params.toString()}`;
}
