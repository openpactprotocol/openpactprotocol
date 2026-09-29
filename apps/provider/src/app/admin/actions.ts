"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { aops, agentPlatforms, customerPlatforms, customers } from "../../db/schema.js";
import { getDb } from "../../db/client.js";

export async function togglePlatform(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  await getDb().update(agentPlatforms).set({ enabled: !enabled }).where(eq(agentPlatforms.id, id));
  revalidatePath("/admin");
}

export async function toggleCustomer(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  await getDb().update(customers).set({ a2aEnabled: !enabled }).where(eq(customers.id, id));
  revalidatePath("/admin");
}

export async function toggleAllowlist(formData: FormData): Promise<void> {
  const customerId = String(formData.get("customerId") ?? "");
  const platformId = String(formData.get("platformId") ?? "");
  const allowed = formData.get("allowed") === "true";
  const db = getDb();
  await db
    .insert(customerPlatforms)
    .values({ customerId, platformId, allowed: !allowed })
    .onConflictDoUpdate({
      target: [customerPlatforms.customerId, customerPlatforms.platformId],
      set: { allowed: !allowed },
    });
  revalidatePath("/admin");
}

export async function updateAopChannels(formData: FormData): Promise<void> {
  const customerId = String(formData.get("customerId") ?? "");
  const aopId = String(formData.get("aopId") ?? "");
  const channels = ["chat", "voice", "a2a"].filter((channel) => formData.get(channel) === "on");
  await getDb()
    .update(aops)
    .set({ channels })
    .where(and(eq(aops.customerId, customerId), eq(aops.id, aopId)));
  revalidatePath("/admin");
}
