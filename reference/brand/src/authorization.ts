export const FLIGHT_REBOOK_TYPE = "https://skyline.example/authorization/flight-rebook/v1";
export type FlightRebookAuthorization = {
  type: typeof FLIGHT_REBOOK_TYPE;
  identifier: string;
  actions: ["rebook"];
  target_flight: string;
};

export function flightRebookAuthorizations(value: unknown): FlightRebookAuthorization[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Expected authorization details");
  return value.map((detail: unknown) => {
    if (typeof detail !== "object" || detail === null)
      throw new Error("Invalid flight authorization");
    const d = detail as Record<string, unknown>;
    if (
      Object.keys(d).some(
        (key) => !["type", "identifier", "actions", "target_flight"].includes(key),
      ) ||
      d.type !== FLIGHT_REBOOK_TYPE ||
      typeof d.identifier !== "string" ||
      !d.identifier.trim() ||
      !Array.isArray(d.actions) ||
      d.actions.length !== 1 ||
      d.actions[0] !== "rebook" ||
      typeof d.target_flight !== "string" ||
      !/^[A-Z]{2} \d{2,4}$/.test(d.target_flight)
    ) {
      throw new Error("Invalid flight authorization");
    }
    return {
      type: FLIGHT_REBOOK_TYPE,
      identifier: d.identifier,
      actions: ["rebook"],
      target_flight: d.target_flight,
    };
  });
}

// Multiple entries authorize a union of exact reservation/flight pairs.
export function permitsRebooking(value: unknown, confirmation: string, flight: string): boolean {
  if (value === undefined) return true;
  try {
    return flightRebookAuthorizations(value).some(
      (d) => d.identifier === confirmation && d.target_flight === flight,
    );
  } catch {
    return false;
  }
}
