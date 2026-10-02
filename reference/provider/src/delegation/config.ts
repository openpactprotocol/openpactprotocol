export type ScopeDefinition = {
  id: string;
  description: string;
  detail: string;
  writes?: boolean;
};

export type DelegationConfig = {
  brandUrl: string;
  color: string;
  scopes: ScopeDefinition[];
};

// Per-Brand delegation setup. In a real Provider the Brand configures this;
// here only Skyline offers delegation, and only when DELEGATION_ENABLED is set.
const BRAND_SCOPES: Record<string, { color: string; scopes: ScopeDefinition[] }> = {
  "Skyline Airways": {
    color: "#16345c",
    scopes: [
      {
        id: "flights:upcoming:read",
        description: "View upcoming flights",
        detail: "Trips, seats and booking details",
      },
      {
        id: "flights:history:read",
        description: "View past flights",
        detail: "Flight history and receipts",
      },
      {
        id: "flights:rebook",
        description: "Rebook flights",
        detail: "Change or rebook your flights",
        writes: true,
      },
    ],
  },
};

export function delegationEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.DELEGATION_ENABLED ?? "");
}

export function delegationConfig(customerName: string): DelegationConfig | undefined {
  if (!delegationEnabled()) return undefined;
  const brand = BRAND_SCOPES[customerName];
  if (!brand) return undefined;
  return {
    ...brand,
    brandUrl: (process.env.BRAND_URL ?? "http://localhost:3004").replace(/\/+$/, ""),
  };
}

export function delegationUrls(baseUrl: string, customerId: string) {
  const interfaceUrl = `${baseUrl.replace(/\/+$/, "")}/a2a/${customerId}`;
  const issuer = `${interfaceUrl}/oauth`;
  return {
    interfaceUrl,
    issuer,
    metadata: `${issuer}/.well-known/oauth-authorization-server`,
    jwks: `${issuer}/jwks.json`,
    deviceAuthorization: `${issuer}/device_authorization`,
    token: `${issuer}/token`,
    consent: `${issuer}/consent`,
    consentDecision: `${issuer}/consent/decision`,
  };
}
