import { describe, expect, it } from "vitest";
import {
  A2A_ERRORS,
  A2AErrorResponseSchema,
  AgentCardSchema,
  MessageSchema,
  PartSchema,
  PlatformRegistrationRequestSchema,
  PlatformRegistrationResponseSchema,
  SecuritySchemeSchema,
  TaskSchema,
  TaskStateSchema,
} from "./index.js";

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
        { url: "https://example.com/a2a", protocolBinding: "HTTP+JSON", protocolVersion: "1.0" },
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

  it("allows Tasks and Messages to omit contextId", () => {
    expect(
      TaskSchema.parse({ id: "task-1", status: { state: "TASK_STATE_COMPLETED" } }),
    ).not.toHaveProperty("contextId");
    expect(
      MessageSchema.parse({
        messageId: "message-1",
        role: "ROLE_USER",
        parts: [{ text: "hello" }],
      }),
    ).not.toHaveProperty("contextId");
  });

  it("shares protocol error HTTP and gRPC status mappings", () => {
    expect(A2A_ERRORS.TASK_NOT_FOUND).toEqual({ httpStatus: 404, status: "NOT_FOUND" });
    expect(A2A_ERRORS.TASK_NOT_CANCELABLE).toEqual({
      httpStatus: 409,
      status: "FAILED_PRECONDITION",
    });
    expect(A2A_ERRORS.UNSUPPORTED_OPERATION).toEqual({
      httpStatus: 400,
      status: "UNIMPLEMENTED",
    });
  });

  it("validates AIP-193 HTTP error responses", () => {
    expect(
      A2AErrorResponseSchema.parse({
        error: {
          code: 404,
          status: "NOT_FOUND",
          message: "Task not found",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "TASK_NOT_FOUND",
              domain: "a2a-protocol.org",
            },
          ],
        },
      }).error.details[0]?.reason,
    ).toBe("TASK_NOT_FOUND");
  });

  it("validates platform registration request and response schemas", () => {
    expect(
      PlatformRegistrationRequestSchema.parse({
        name: "demo-pa",
        jwksUri: "https://pa.example/.well-known/jwks.json",
      }),
    ).toEqual({
      name: "demo-pa",
      jwksUri: "https://pa.example/.well-known/jwks.json",
    });
    expect(
      PlatformRegistrationRequestSchema.safeParse({
        name: "Demo PA",
        jwksUri: "https://pa.example/.well-known/jwks.json",
      }).success,
    ).toBe(false);
    expect(
      PlatformRegistrationResponseSchema.parse({
        platform: {
          id: "00000000-0000-4000-8000-000000000000",
          name: "demo-pa",
          issuer: "https://pa.example",
          jwksUri: "https://pa.example/.well-known/jwks.json",
          enabled: true,
        },
      }).platform.enabled,
    ).toBe(true);
  });
});
