import { describe, expect, it } from "vitest";
import { composeFallbackReply } from "./composer.js";

describe("composeFallbackReply", () => {
  it("labels a single business reply", () => {
    expect(
      composeFallbackReply({
        replies: [{ businessName: "Skyline Airways", reply: "Flight SK 482 is delayed." }],
        unreachable: [],
      }),
    ).toBe("Skyline Airways: Flight SK 482 is delayed.");
  });

  it("joins several business replies", () => {
    expect(
      composeFallbackReply({
        replies: [
          { businessName: "Skyline Airways", reply: "Flight SK 482 is delayed." },
          { businessName: "Loom & Co.", reply: "Order LC-1042 is out for delivery." },
        ],
        unreachable: [],
      }),
    ).toBe(
      "Skyline Airways: Flight SK 482 is delayed.\n\nLoom & Co.: Order LC-1042 is out for delivery.",
    );
  });

  it("includes an unreachable business after successful replies", () => {
    expect(
      composeFallbackReply({
        replies: [{ businessName: "Skyline Airways", reply: "Flight SK 482 is delayed." }],
        unreachable: ["Bloom & Stem"],
      }),
    ).toBe("Skyline Airways: Flight SK 482 is delayed.\n\nI couldn't reach Bloom & Stem.");
  });
});
