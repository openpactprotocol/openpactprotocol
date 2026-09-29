import { describe, expect, it } from "vitest";
import { AgentCardSchema, PartSchema, SecuritySchemeSchema, TaskStateSchema } from "./index.js";

describe("protocol schemas", () => {
  it("accepts exactly one Part content field", () => {
    expect(PartSchema.safeParse({ text: "hello" }).success).toBe(true);
    expect(PartSchema.safeParse({ raw: "aGVsbG8=" }).success).toBe(true);
    expect(PartSchema.safeParse({ raw: "not base64!" }).success).toBe(false);
    expect(PartSchema.safeParse({ text: "hello", url: "https://example.com" }).success).toBe(false);
    expect(PartSchema.safeParse({ kind: "text", text: "hello" }).success).toBe(false);
  });

  it("accepts exactly one security-scheme wrapper", () => {
    expect(
      SecuritySchemeSchema.safeParse({
        httpAuthSecurityScheme: { scheme: "Bearer" },
        apiKeySecurityScheme: { name: "key", in: "HEADER" },
      }).success,
    ).toBe(false);
  });

  it("round-trips an AgentCard using proto field names", () => {
    const card = {
      name: "Example",
      description: "Example support",
      supportedInterfaces: [
        { url: "https://example.com/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      ],
      version: "0.1.0",
      capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
      securitySchemes: {
        paPlatformJwt: { httpAuthSecurityScheme: { scheme: "Bearer", bearerFormat: "JWT" } },
      },
      securityRequirements: [{ schemes: { paPlatformJwt: { list: [] } } }],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [
        { id: "faq", name: "FAQ", description: "Help", tags: ["help"], examples: ["Hours?"] },
      ],
    };
    expect(AgentCardSchema.parse(JSON.parse(JSON.stringify(card)))).toEqual(card);
  });

  it("uses the proto enum names", () => {
    expect(TaskStateSchema.parse("TASK_STATE_COMPLETED")).toBe("TASK_STATE_COMPLETED");
    expect(TaskStateSchema.safeParse("completed").success).toBe(false);
  });
});
