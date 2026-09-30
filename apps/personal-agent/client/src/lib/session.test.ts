import { describe, expect, it } from "vitest";
import { homePath, parseCustomerIds } from "./session.js";

describe("customer session configuration", () => {
  it("splits customer IDs on commas and whitespace, removing duplicates and empties", () => {
    expect(parseCustomerIds(" skyline, loom \n bloom,, skyline ")).toEqual([
      "skyline",
      "loom",
      "bloom",
    ]);
    expect(parseCustomerIds(undefined)).toEqual([]);
  });

  it("includes customer IDs, conversation, and registration in the home URL", () => {
    const url = new URL(
      homePath({
        providerUrl: "https://provider.example",
        customerIds: ["skyline", "loom"],
        conversationId: "conversation-1",
        registration: { status: "created", name: "demo-pa" },
      }),
      "https://client.example",
    );
    expect(url.searchParams.get("providerUrl")).toBe("https://provider.example");
    expect(url.searchParams.get("customerIds")).toBe("skyline,loom");
    expect(url.searchParams.get("conversation")).toBe("conversation-1");
    expect(url.searchParams.get("registration")).toBe("created");
    expect(url.searchParams.get("platformName")).toBe("demo-pa");
  });
});
