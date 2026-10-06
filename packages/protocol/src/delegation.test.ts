import { describe, expect, it } from "vitest";
import {
  DelegatedSendMessageResponseSchema,
  DelegationTokenClaimsSchema,
  DeviceAuthorizationResponseSchema,
  OAuth2DeviceCodeSecuritySchemeSchema,
  PACT_METADATA,
  ReceiptSchema,
  StepUpMetadataSchema,
  TokenResponseSchema,
  formatScope,
  parseScope,
} from "./delegation.js";
import { AgentCardSchema, SecuritySchemeSchema } from "./index.js";

const brandUrl = "https://provider.example.com/a2a/01J";

// Examples from spec §5, verbatim apart from the elided ids.
const userDelegation = {
  oauth2SecurityScheme: {
    flows: {
      deviceCode: {
        deviceAuthorizationUrl: `${brandUrl}/oauth/device_authorization`,
        tokenUrl: `${brandUrl}/oauth/token`,
        scopes: {
          "orders:read": "Look up your orders and their status",
          "orders:cancel": "Cancel an order that has not shipped",
        },
      },
    },
    oauth2MetadataUrl: `${brandUrl}/oauth/.well-known/oauth-authorization-server`,
  },
};

describe("delegation schemas", () => {
  it("parses the §5.1 card security scheme with both requirement entries", () => {
    expect(OAuth2DeviceCodeSecuritySchemeSchema.parse(userDelegation)).toEqual(userDelegation);
    expect(SecuritySchemeSchema.safeParse(userDelegation).success).toBe(true);
    const card = AgentCardSchema.parse({
      name: "Example Co. Support",
      description: "Support",
      supportedInterfaces: [
        { url: brandUrl, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" },
      ],
      version: "0.1.0",
      capabilities: {},
      securitySchemes: {
        paJwt: { httpAuthSecurityScheme: { scheme: "Bearer", bearerFormat: "JWT" } },
        userDelegation,
      },
      securityRequirements: [
        { schemes: { paJwt: { list: [] } } },
        { schemes: { paJwt: { list: [] }, userDelegation: { list: [] } } },
      ],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [],
    });
    expect(card.securityRequirements).toHaveLength(2);
    expect(
      OAuth2DeviceCodeSecuritySchemeSchema.safeParse({
        oauth2SecurityScheme: { ...userDelegation.oauth2SecurityScheme, oauth2MetadataUrl: "" },
      }).success,
    ).toBe(false);
  });

  it("parses §5.3 device authorization and token responses", () => {
    expect(
      DeviceAuthorizationResponseSchema.parse({
        device_code: "dc_9f3c",
        user_code: "WDJB-MJHT",
        verification_uri: "https://brand.example/login?return_to=x",
        verification_uri_complete:
          "https://brand.example/login?return_to=x%3Fuser_code%3DWDJB-MJHT",
        expires_in: 600,
        interval: 5,
      }).interval,
    ).toBe(5);
    const token = TokenResponseSchema.parse({
      token_type: "Bearer",
      access_token: "eyJ",
      refresh_token: "rt_",
      expires_in: 3600,
      scope: "orders:read orders:cancel",
    });
    expect(parseScope(token.scope)).toEqual(["orders:read", "orders:cancel"]);
    expect(TokenResponseSchema.safeParse({ ...token, token_type: "MAC" }).success).toBe(false);
  });

  it("parses §5.4 delegation token claims", () => {
    const claims = {
      iss: `${brandUrl}/oauth`,
      aud: brandUrl,
      sub: "jane-4471",
      client_id: "https://pa.example.com",
      scope: "orders:read",
      grant_id: "a2agrant_1",
      iat: 1,
      exp: 3601,
    };
    expect(DelegationTokenClaimsSchema.parse(claims)).toEqual(claims);
    expect(DelegationTokenClaimsSchema.safeParse({ ...claims, grant_id: "" }).success).toBe(false);
  });

  it("parses a §5.5 step-up task and rejects a reply with both message and task", () => {
    const task = {
      id: "t-01J",
      contextId: "f0c12e6b",
      status: {
        state: "TASK_STATE_AUTH_REQUIRED",
        message: {
          messageId: "m-1",
          role: "ROLE_AGENT",
          parts: [{ text: "I need permission to issue refunds." }],
        },
      },
      metadata: {
        "pact.missingScopes": ["refunds:issue"],
        "pact.verificationUriComplete": "https://brand.example/login?return_to=x",
      },
    };
    const parsed = DelegatedSendMessageResponseSchema.parse({ task });
    expect("task" in parsed && StepUpMetadataSchema.parse(parsed.task.metadata)).toEqual(
      task.metadata,
    );
    expect(StepUpMetadataSchema.safeParse({ [PACT_METADATA.missingScopes]: [] }).success).toBe(
      false,
    );
    expect(
      DelegatedSendMessageResponseSchema.safeParse({ task, message: task.status.message }).success,
    ).toBe(false);
  });

  it("parses a §5.6 receipt", () => {
    const receipt = {
      jws: "eyJh.eyJi.c2ln",
      claims: {
        grantId: "a2agrant_1",
        user: "jane-4471",
        pa: "https://pa.example.com",
        brand: brandUrl,
        scopesUsed: ["orders:read", "orders:cancel"],
        actions: [{ tool: "lookup_orders" }, { tool: "cancel_order", argsHash: "abc" }],
        ts: "2026-09-30T12:00:00Z",
      },
    };
    expect(ReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(ReceiptSchema.safeParse({ ...receipt, jws: "not-a-jws" }).success).toBe(false);
  });

  it("formats and parses space-separated scopes without duplicates", () => {
    expect(formatScope(["a:read", "b:write", "a:read"])).toBe("a:read b:write");
    expect(parseScope(" a:read  b:write a:read ")).toEqual(["a:read", "b:write"]);
    expect(parseScope("")).toEqual([]);
  });
});
