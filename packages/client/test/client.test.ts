import { describe, expect, it } from "vitest";
import { A2AClient, A2AError, A2AHttpError, fetchAgentCard, interfaceUrl } from "../src/index.js";

const skylineCustomerId = "01M3R53Q5SZQ6FQSMSDBSSREAA";
const skylineInterfaceUrl = `https://provider.example/a2a/${skylineCustomerId}`;
const skylineCard = {
  name: "Skyline Airways",
  description: "Flight status and trip changes.",
  supportedInterfaces: [
    { url: skylineInterfaceUrl, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" },
  ],
  version: "1.0",
  capabilities: {},
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "flight-status",
      name: "Flight status",
      description: "Check departure and arrival times for a booked flight.",
      tags: ["flight", "delay"],
      examples: ["Is my Friday flight on time?"],
    },
  ],
};

describe("@pact/client", () => {
  it("fetches and validates an Agent Card and selects the HTTP+JSON 1.0 interface", async () => {
    const fetched: string[] = [];
    const card = await fetchAgentCard(
      `${skylineInterfaceUrl}/.well-known/agent-card.json`,
      async (input) => {
        fetched.push(input.toString());
        return Response.json(skylineCard);
      },
    );
    expect(fetched).toEqual([`${skylineInterfaceUrl}/.well-known/agent-card.json`]);
    expect(card.name).toBe("Skyline Airways");
    expect(interfaceUrl(card)).toBe(skylineInterfaceUrl);
    expect(() =>
      interfaceUrl({
        ...card,
        supportedInterfaces: [{ ...card.supportedInterfaces[0]!, protocolBinding: "GRPC" }],
      }),
    ).toThrow("HTTP+JSON 1.0");
  });

  it("turns a non-2xx card response into A2AHttpError", async () => {
    await expect(
      fetchAgentCard(
        "https://provider.example/missing",
        async () => new Response("", { status: 404 }),
      ),
    ).rejects.toMatchObject({ name: "A2AHttpError", status: 404 });
  });

  it("sends message:send with a fresh token and A2A headers", async () => {
    let tokens = 0;
    const requests: { url: URL; init: RequestInit }[] = [];
    const message = {
      messageId: "agent-message",
      contextId: "00000000-0000-4000-8000-000000000000",
      role: "ROLE_AGENT",
      parts: [{ text: "I can check that. What's your confirmation code?" }],
    };
    const client = new A2AClient({
      url: `${skylineInterfaceUrl}/`,
      getToken: () => `token-${++tokens}`,
      fetchImpl: async (input, init) => {
        requests.push({ url: new URL(input.toString()), init: init ?? {} });
        return Response.json({ message });
      },
    });

    expect(
      await client.sendMessage("Is my Friday flight on time?", { contextId: message.contextId }),
    ).toEqual(message);
    expect(await client.sendMessage("ABC123")).toEqual(message);
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      `/a2a/${skylineCustomerId}/message:send`,
      `/a2a/${skylineCustomerId}/message:send`,
    ]);
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      headers: {
        "A2A-Version": "1.0",
        Authorization: "Bearer token-1",
        "Content-Type": "application/json",
      },
    });
    expect(new Headers(requests[1]?.init.headers).get("Authorization")).toBe("Bearer token-2");
    const body = JSON.parse(String(requests[0]?.init.body));
    expect(body).toMatchObject({
      message: {
        contextId: message.contextId,
        role: "ROLE_USER",
        parts: [{ text: "Is my Friday flight on time?", mediaType: "text/plain" }],
      },
    });
    expect(body.message).not.toHaveProperty("taskId");
    expect(JSON.parse(String(requests[1]?.init.body)).message).not.toHaveProperty("contextId");
  });

  it("parses AIP-193 errors and preserves bare HTTP errors", async () => {
    const a2aClient = new A2AClient({
      url: skylineInterfaceUrl,
      getToken: () => "token",
      fetchImpl: async () =>
        Response.json(
          {
            error: {
              code: 404,
              status: "NOT_FOUND",
              message: "Task not found: missing",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason: "TASK_NOT_FOUND",
                  domain: "a2a-protocol.org",
                },
              ],
            },
          },
          { status: 404 },
        ),
    });
    await expect(a2aClient.sendMessage("hello")).rejects.toMatchObject({
      name: "A2AError",
      httpStatus: 404,
      status: "NOT_FOUND",
      reason: "TASK_NOT_FOUND",
      message: "Task not found: missing",
    });

    const httpClient = new A2AClient({
      url: skylineInterfaceUrl,
      getToken: () => "token",
      fetchImpl: async () => new Response(null, { status: 401 }),
    });
    await expect(httpClient.sendMessage("hello")).rejects.toBeInstanceOf(A2AHttpError);
    await expect(httpClient.sendMessage("hello")).rejects.toMatchObject({ status: 401, body: "" });
  });

  it("exposes A2AError with structured details", () => {
    const error = new A2AError(
      400,
      "FAILED_PRECONDITION",
      "UNSUPPORTED_OPERATION",
      "Unsupported",
      [],
    );
    expect(error).toMatchObject({
      httpStatus: 400,
      status: "FAILED_PRECONDITION",
      reason: "UNSUPPORTED_OPERATION",
      message: "Unsupported",
      details: [],
    });
  });
});
