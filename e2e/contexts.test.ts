import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTEXTS_EXTENSION_URI,
  ContextsMessageMetadataSchema,
  type ContextsMessageMetadata,
  type Message,
} from "@openpactprotocol/protocol";
import {
  A2AClient,
  createPlatformSigner,
  fetchAgentCard,
  interfaceUrl,
} from "@openpactprotocol/client";

// Contexts extension v1 (docs/extensions/contexts/v1.md). Skips when the card
// doesn't list the extension.

function readLocalEnv(): void {
  const path = fileURLToPath(
    new URL("../reference/personal-agent/client/.env.local", import.meta.url),
  );
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] && !process.env[match[1]]) {
      process.env[match[1]] = (match[2] ?? "").replace(/^['"]|['"]$/g, "");
    }
  }
}

readLocalEnv();

const providerUrl = (process.env.PROVIDER_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const customerId = process.env.CONTEXTS_CUSTOMER_ID ?? process.env.CUSTOMER_ID ?? "";
const otherCustomerId = process.env.OTHER_CUSTOMER_ID ?? "";

async function loadCard(id: string) {
  const card = await fetchAgentCard(`${providerUrl}/a2a/${id}/.well-known/agent-card.json`);
  return { card, url: interfaceUrl(card) };
}

const target = customerId ? await loadCard(customerId).catch(() => undefined) : undefined;
const extension = target?.card.capabilities.extensions?.find(
  ({ uri }) => uri === CONTEXTS_EXTENSION_URI,
);

const signer = () =>
  createPlatformSigner({
    privateJwk: process.env.PA_PRIVATE_JWK ?? "",
    issuer: process.env.PA_ISSUER ?? "",
  });

function client(sub: string, url = target?.url ?? ""): A2AClient {
  const pa = signer();
  return new A2AClient({
    url,
    getToken: () => pa.sign({ sub, aud: process.env.PA_AUDIENCE ?? "" }),
  });
}

function metadata(message: Message): ContextsMessageMetadata {
  return ContextsMessageMetadataSchema.parse(message.metadata?.[CONTEXTS_EXTENSION_URI]);
}

async function get(path: string, sub: string): Promise<Response> {
  const token = await signer().sign({ sub, aud: process.env.PA_AUDIENCE ?? "" });
  return fetch(`${target?.url}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, "A2A-Version": "1.0" },
  });
}

const invalidParams = { name: "A2AError", httpStatus: 400, reason: "INVALID_PARAMS" };

describe.skipIf(!extension)("Contexts extension v1", () => {
  const sub = `contexts-${crypto.randomUUID()}`;
  const contextIds: string[] = [];

  it("is advertised as optional", () => {
    expect(extension).toMatchObject({ uri: CONTEXTS_EXTENSION_URI, required: false });
  });

  it("returns status on message:send replies", async () => {
    for (const text of ["Is my Friday flight on time?", "I need help with my order."]) {
      const reply = await client(sub).sendMessage(text);
      expect(metadata(reply).status).toMatch(/^(open|escalated|closed)$/);
      if (!reply.contextId) throw new Error("Reply has no contextId");
      contextIds.push(reply.contextId);
    }
  });

  it("lists the caller's contexts newest first and pages through them", async () => {
    const all = await client(sub).listContexts();
    expect(all.pageSize).toBe(20);
    expect(all.contexts.map(({ contextId }) => contextId)).toEqual([...contextIds].reverse());

    const first = await client(sub).listContexts({ pageSize: 1 });
    expect(first.contexts.map(({ contextId }) => contextId)).toEqual([contextIds[1]]);
    expect(first.nextPageToken).not.toBe("");
    const second = await client(sub).listContexts({ pageSize: 1, pageToken: first.nextPageToken });
    expect(second.contexts.map(({ contextId }) => contextId)).toEqual([contextIds[0]]);

    const response = await get("contexts", sub);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/a2a+json");
  });

  it("lists messages oldest first with createdAt and author", async () => {
    const contextId = contextIds[0] ?? "";
    const page = await client(sub).listContextMessages(contextId);
    expect(page.pageSize).toBe(50);
    expect(page.messages[0]).toMatchObject({
      contextId,
      role: "ROLE_USER",
      parts: [{ text: "Is my Friday flight on time?" }],
    });
    const times = page.messages.map((message) => metadata(message).createdAt ?? "");
    expect(times.every(Boolean)).toBe(true);
    expect([...times].sort((a, b) => Date.parse(a) - Date.parse(b))).toEqual(times);
    for (const message of page.messages.filter(({ role }) => role === "ROLE_AGENT")) {
      expect(metadata(message).author).toMatch(/^(ai|human)$/);
    }
  });

  it("hides contexts from other users and Brands", async () => {
    const contextId = contextIds[0] ?? "";
    const other = client(`other-${crypto.randomUUID()}`);
    expect((await other.listContexts()).contexts).toEqual([]);
    for (const id of [contextId, crypto.randomUUID()]) {
      await expect(other.listContextMessages(id)).rejects.toMatchObject(invalidParams);
    }
    if (otherCustomerId) {
      const otherBrand = await loadCard(otherCustomerId);
      await expect(
        client(sub, otherBrand.url).listContextMessages(contextId),
      ).rejects.toMatchObject(invalidParams);
    }
  });

  it("rejects bad pagination and missing tokens", async () => {
    for (const pageSize of [0, 101]) {
      await expect(client(sub).listContexts({ pageSize })).rejects.toMatchObject(invalidParams);
      await expect(
        client(sub).listContextMessages(contextIds[0] ?? "", { pageSize }),
      ).rejects.toMatchObject(invalidParams);
    }
    await expect(client(sub).listContexts({ pageToken: "not-a-token" })).rejects.toMatchObject(
      invalidParams,
    );
    expect((await get("contexts?pageSize=abc", sub)).status).toBe(400);
    const unauthenticated = await fetch(`${target?.url}/contexts`);
    expect(unauthenticated.status).toBe(401);
  });
});
