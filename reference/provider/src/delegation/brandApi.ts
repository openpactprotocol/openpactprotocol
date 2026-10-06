// Calls the Brand's own account API with the User's delegation token. The
// Brand verifies the token against the Provider's JWKS, so the Brand API only
// ever acts for the user and scopes in the token.

export type Flight = {
  flight: string;
  from: string;
  to: string;
  date: string;
  departs: string;
  arrives: string;
};

export type Trip = Flight & {
  confirmation: string;
  seat: string;
  status: "on_time" | "delayed";
  delayMinutes: number;
  scheduledDeparts: string;
  alternatives: (Flight & { seatsLeft: number; changeFee: number })[];
};

export class BrandApiError extends Error {}

async function call<T>(
  brandUrl: string,
  token: string,
  path: string,
  init: { method?: string; body?: unknown; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const response = await (init.fetchImpl ?? fetch)(`${brandUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new BrandApiError(`Brand API ${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function listUpcomingTrips(brandUrl: string, token: string, fetchImpl?: typeof fetch) {
  return call<{ trips: Trip[] }>(brandUrl, token, "/api/trips/upcoming", {
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

export function listPastTrips(brandUrl: string, token: string, fetchImpl?: typeof fetch) {
  return call<{ trips: Trip[] }>(brandUrl, token, "/api/trips/past", {
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

export function rebookTrip(
  brandUrl: string,
  token: string,
  input: { confirmation: string; flight: string },
  fetchImpl?: typeof fetch,
) {
  return call<{ trip: Trip }>(
    brandUrl,
    token,
    `/api/trips/${encodeURIComponent(input.confirmation)}/rebook`,
    { method: "POST", body: { flight: input.flight }, ...(fetchImpl ? { fetchImpl } : {}) },
  );
}
