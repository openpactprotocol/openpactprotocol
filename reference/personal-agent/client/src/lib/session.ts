export const USER_ID_COOKIE = "pact_user_id";

export const USER_ID_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;

export type RegistrationNotice =
  | { status: "created" | "existing"; name: string }
  | { status: "error"; name: string; message: string };

export function defaultPlatformName(): string {
  return process.env.PA_PLATFORM_NAME || "demo-pa";
}

export function parseCustomerIds(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(/[,\s]+/)
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

export function homePath(input: {
  providerUrl: string;
  customerIds: string[];
  conversationId?: string;
  registration?: RegistrationNotice;
}): string {
  const params = new URLSearchParams({
    providerUrl: input.providerUrl,
    customerIds: input.customerIds.join(","),
  });
  if (input.conversationId) params.set("conversation", input.conversationId);
  if (input.registration) {
    params.set("registration", input.registration.status);
    params.set("platformName", input.registration.name);
    if (input.registration.status === "error") {
      params.set("registrationError", input.registration.message);
    }
  }
  return `/?${params.toString()}`;
}

export function readRegistrationNotice(query: {
  registration?: string;
  platformName?: string;
  registrationError?: string;
}): RegistrationNotice | undefined {
  const name = query.platformName ?? defaultPlatformName();
  if (query.registration === "created" || query.registration === "existing") {
    return { status: query.registration, name };
  }
  if (query.registration === "error") {
    return { status: "error", name, message: query.registrationError ?? "Registration failed" };
  }
  return undefined;
}
