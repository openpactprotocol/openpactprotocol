"use server";

import { A2AClient, createPlatformSigner, discoverAgent } from "@pap/client";
import { redirect } from "next/navigation";

function clientContext(input: { providerUrl: string; slug: string; userId: string }): {
  providerUrl: string;
  slug: string;
  userId: string;
} {
  return {
    providerUrl: input.providerUrl || process.env.PROVIDER_URL || "http://localhost:3000",
    slug: input.slug || process.env.CUSTOMER_SLUG || "",
    userId: input.userId || process.env.PA_USER_ID || "demo-user",
  };
}

async function createClient(input: {
  providerUrl: string;
  slug: string;
  userId: string;
}): Promise<A2AClient> {
  const context = clientContext(input);
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  if (!issuer || !privateJwk)
    throw new Error("Set PA_ISSUER and PA_PRIVATE_JWK in the server environment");
  const discovered = await discoverAgent(context.providerUrl, context.slug);
  return new A2AClient({
    url: discovered.url,
    signer: createPlatformSigner({ issuer, privateJwk }),
    userId: context.userId,
  });
}

export async function sendChatMessage(formData: FormData): Promise<void> {
  const providerUrl = String(formData.get("providerUrl") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const text = String(formData.get("text") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  const client = await createClient({ providerUrl, slug, userId });
  const result = await client.sendMessage(text, taskId ? { taskId } : {});
  redirect(
    `/?providerUrl=${encodeURIComponent(clientContext({ providerUrl, slug, userId }).providerUrl)}&slug=${encodeURIComponent(slug)}&userId=${encodeURIComponent(userId)}&task=${encodeURIComponent(result.task.id)}`,
  );
}
