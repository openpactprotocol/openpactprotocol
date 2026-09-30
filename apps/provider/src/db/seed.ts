import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { closeDb, getDb, type Db } from "./client.js";
import { agentPlatforms, customers } from "./schema.js";

export async function seedDatabase(
  db: Db,
  paIssuer: string,
  options: { seedDemoPlatform?: boolean } = {},
): Promise<{ acmeSlug: string; globexSlug: string }> {
  const issuer = paIssuer.replace(/\/+$/, "");
  if (!issuer) throw new Error("PA_ISSUER is required");

  const customerRows: Record<string, typeof customers.$inferSelect> = {};
  for (const [name, suffix] of [
    ["Acme Health", "acme_health"],
    ["Globex Clinic", "globex_clinic"],
  ] as const) {
    const existing = await db.query.customers.findFirst({ where: eq(customers.name, name) });
    let customer = existing;
    if (!customer) {
      const id = uuidv7();
      const [created] = await db
        .insert(customers)
        .values({ id, slug: `${id.slice(-7)}_${suffix}`, name })
        .returning();
      if (!created) throw new Error(`Failed to seed customer ${name}`);
      customer = created;
    }
    customerRows[name] = customer;
  }

  const demoIssuer = issuer;
  const disabledIssuer = `${issuer}/disabled-pa`;
  const platformSeeds = [
    ...((options.seedDemoPlatform ?? process.env.SEED_DEMO_PLATFORM !== "false")
      ? [{ name: "demo-pa", issuer: demoIssuer, enabled: true }]
      : []),
    { name: "disabled-pa", issuer: disabledIssuer, enabled: false },
  ];
  for (const { name, issuer: platformIssuer, enabled } of platformSeeds) {
    await db
      .insert(agentPlatforms)
      .values({
        name,
        issuer: platformIssuer,
        jwksUri: `${issuer}/.well-known/jwks.json`,
        enabled,
      })
      .onConflictDoUpdate({
        target: agentPlatforms.name,
        set: { issuer: platformIssuer, jwksUri: `${issuer}/.well-known/jwks.json`, enabled },
      });
  }

  return {
    acmeSlug: customerRows["Acme Health"]!.slug,
    globexSlug: customerRows["Globex Clinic"]!.slug,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const paIssuer = process.env.PA_ISSUER;
  if (!paIssuer) throw new Error("PA_ISSUER is required");
  try {
    const slugs = await seedDatabase(getDb(), paIssuer);
    console.log(`Acme Health slug: ${slugs.acmeSlug}`);
    console.log(`Globex Clinic slug: ${slugs.globexSlug}`);
  } finally {
    await closeDb();
  }
}
