import { describe, expect, it } from "vitest";
import {
  FLIGHT_REBOOK_TYPE,
  flightRebookAuthorizations,
  permitsRebooking,
} from "./authorization.js";
const detail = {
  type: FLIGHT_REBOOK_TYPE,
  identifier: "K7PQ2M",
  actions: ["rebook"],
  target_flight: "SK 318",
};
describe("Skyline rebooking authorization", () => {
  it("restricts both reservation and target while retaining scope-only behavior", () => {
    expect(permitsRebooking([detail], "K7PQ2M", "SK 318")).toBe(true);
    expect(permitsRebooking([detail], "OTHER", "SK 318")).toBe(false);
    expect(permitsRebooking([detail], "K7PQ2M", "SK 999")).toBe(false);
    expect(permitsRebooking(undefined, "OTHER", "SK 999")).toBe(true);
  });
  it("combines exact pairs without crossing reservation and flight permissions", () => {
    const second = { ...detail, identifier: "OTHER", target_flight: "SK 999" };
    expect(permitsRebooking([detail, second], "OTHER", "SK 999")).toBe(true);
    expect(permitsRebooking([detail, second], "K7PQ2M", "SK 999")).toBe(false);
  });
  it.each([
    null,
    [],
    [{ ...detail, type: "unknown" }],
    [{ ...detail, max_fee: 0 }],
    [{ ...detail, actions: ["cancel"] }],
    [{ ...detail, identifier: "" }],
  ])("rejects unsupported conditions rather than discarding them: %j", (value) => {
    expect(() => flightRebookAuthorizations(value)).toThrow();
    expect(permitsRebooking(value, "K7PQ2M", "SK 318")).toBe(false);
  });
});
