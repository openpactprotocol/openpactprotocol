import { describe, expect, it } from "vitest";
import { routeMessage, type RoutableBusiness } from "./router.js";

const businesses: RoutableBusiness[] = [
  {
    customerId: "skyline",
    name: "Skyline Airways",
    keywords: ["flight", "flights", "airline", "delay", "trip"],
  },
  {
    customerId: "loom",
    name: "Loom & Co.",
    keywords: ["order", "orders", "delivery", "dress", "clothes"],
  },
  {
    customerId: "bloom",
    name: "Bloom & Stem",
    keywords: ["flowers", "bouquet", "roses", "wedding"],
  },
];

describe("routeMessage", () => {
  it("routes by a full business name or its first word", () => {
    expect(
      routeMessage({ text: "Can Skyline Airways help?", businesses, awaitingCustomerIds: [] }),
    ).toEqual(["skyline"]);
    expect(
      routeMessage({ text: "Ask Loom about my order", businesses, awaitingCustomerIds: [] }),
    ).toEqual(["loom"]);
  });

  it("fans out to every business matched by skill keywords", () => {
    expect(
      routeMessage({
        text: "Is my Friday flight on time, and can my dress order arrive Saturday?",
        businesses,
        awaitingCustomerIds: [],
      }),
    ).toEqual(["skyline", "loom"]);
  });

  it("returns matched customer IDs in business order without duplicates", () => {
    const reorderedBusinesses = [
      businesses[1]!,
      businesses[0]!,
      { ...businesses[0]!, name: "Skyline Air" },
    ];
    expect(
      routeMessage({
        text: "Check my flight and dress order",
        businesses: reorderedBusinesses,
        awaitingCustomerIds: [],
      }),
    ).toEqual(["loom", "skyline"]);
  });

  it("routes a follow-up to the first awaiting business only", () => {
    expect(
      routeMessage({
        text: "ABC123",
        businesses,
        awaitingCustomerIds: ["loom", "skyline"],
      }),
    ).toEqual(["loom"]);
  });

  it("uses customer order to break ties between awaiting businesses", () => {
    expect(
      routeMessage({
        text: "ABC123",
        businesses,
        awaitingCustomerIds: ["skyline", "loom"],
      }),
    ).toEqual(["skyline"]);
  });

  it("lets a name mention override a pending follow-up", () => {
    expect(
      routeMessage({
        text: "Loom, can you check my order?",
        businesses,
        awaitingCustomerIds: ["skyline"],
      }),
    ).toEqual(["loom"]);
  });

  it("returns no route when there is no name, keyword, or known pending thread", () => {
    expect(
      routeMessage({
        text: "Can you help me with this?",
        businesses,
        awaitingCustomerIds: ["not-connected"],
      }),
    ).toEqual([]);
  });
});
