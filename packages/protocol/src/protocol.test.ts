import { describe, expect, it } from "vitest";
import {
  A2A_ERRORS,
  A2AErrorResponseSchema,
  AgentCardSchema,
  ListTasksResponseSchema,
  MessageSchema,
  PartSchema,
  PlatformJwtClaimsSchema,
  PlatformRegistrationRequestSchema,
  PlatformRegistrationResponseSchema,
  SecuritySchemeSchema,
  SendMessageResponseSchema,
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
        apiKeySecurityScheme: { name: "key", location: "HEADER" },
      }).success,
    ).toBe(false);
  });

  it("round-trips an AgentCard with the platform JWT security scheme", () => {
    const card = {
      name: "Example",
      description: "Example support",
      supportedInterfaces: [
        { url: "https://example.com/a2a/id", protocolBinding: "HTTP+JSON", protocolVersion: "1.0" },
      ],
      version: "0.1.0",
      capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
      securitySchemes: {
        platformJwt: { httpAuthSecurityScheme: { scheme: "Bearer", bearerFormat: "JWT" } },
      },
      securityRequirements: [{ schemes: { platformJwt: { list: [] } } }],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [
        { id: "faq", name: "FAQ", description: "Help", tags: ["help"], examples: ["Hours?"] },
      ],
    };
    expect(AgentCardSchema.parse(JSON.parse(JSON.stringify(card)))).toEqual(card);
  });

  it("accepts a Message or Task reply and lists tasks", () => {
    const message = {
      messageId: "message-1",
      contextId: "00000000-0000-4000-8000-000000000000",
      role: "ROLE_AGENT",
      parts: [{ text: "Open until 5 PM." }],
    };
    const task = {
      id: "task-1",
      contextId: "00000000-0000-4000-8000-000000000000",
      status: { state: "TASK_STATE_COMPLETED" },
    };
    expect(SendMessageResponseSchema.parse({ message })).toEqual({ message });
    expect(SendMessageResponseSchema.parse({ task })).toEqual({ task });
    expect(SendMessageResponseSchema.safeParse({ task: {} }).success).toBe(false);
    expect(SendMessageResponseSchema.safeParse({ message, task }).success).toBe(false);
    expect(
      ListTasksResponseSchema.parse({
        tasks: [],
        nextPageToken: "",
        pageSize: 50,
        totalSize: 0,
      }).tasks,
    ).toEqual([]);
    expect(
      ListTasksResponseSchema.parse({
        tasks: [task],
        nextPageToken: "",
        pageSize: 50,
        totalSize: 1,
      }).tasks,
    ).toEqual([task]);
    expect(
      ListTasksResponseSchema.safeParse({
        tasks: [{ id: "task-1" }],
        nextPageToken: "",
        pageSize: 50,
        totalSize: 1,
      }).success,
    ).toBe(false);
  });

  it("allows platform JWTs without jti", () => {
    expect(
      PlatformJwtClaimsSchema.parse({
        iss: "https://pa.example",
        sub: "user-1",
        aud: "https://provider.example/a2a",
        iat: 100,
        exp: 200,
      }),
    ).not.toHaveProperty("jti");
  });

  it("shares the exact A2A error HTTP and gRPC status mappings", () => {
    expect(A2A_ERRORS).toEqual({
      INVALID_PARAMS: { httpStatus: 400, status: "INVALID_ARGUMENT" },
      CONTENT_TYPE_NOT_SUPPORTED: { httpStatus: 400, status: "INVALID_ARGUMENT" },
      UNSUPPORTED_OPERATION: { httpStatus: 400, status: "FAILED_PRECONDITION" },
      PUSH_NOTIFICATION_NOT_SUPPORTED: { httpStatus: 400, status: "FAILED_PRECONDITION" },
      TASK_NOT_FOUND: { httpStatus: 404, status: "NOT_FOUND" },
      INTERNAL: { httpStatus: 500, status: "INTERNAL" },
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
    expect(
      MessageSchema.parse({
        messageId: "message-1",
        role: "ROLE_USER",
        parts: [{ text: "hello" }],
      }),
    ).not.toHaveProperty("contextId");
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
