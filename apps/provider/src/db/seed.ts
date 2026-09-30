import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { closeDb, getDb, type Db } from "./client.js";
import { agentPlatforms, customers } from "./schema.js";

export async function seedDatabase(
  db: Db,
  paIssuer: string,
  options: { seedDemoPlatform?: boolean } = {},
): Promise<{ acmeId: string; globexId: string }> {
  const issuer = paIssuer.replace(/\/+$/, "");
  if (!issuer) throw new Error("PA_ISSUER is required");

  const customerRows: Record<string, typeof customers.$inferSelect> = {};
  for (const name of ["Acme Health", "Globex Clinic"]) {
    const existing = await db.query.customers.findFirst({ where: eq(customers.name, name) });
    let customer = existing;
    if (!customer) {
      const id = ulid();
      const [created] = await db.insert(customers).values({ id, name }).returning();
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
        audience: null,
      })
      .onConflictDoUpdate({
        target: agentPlatforms.name,
        set: {
          issuer: platformIssuer,
          jwksUri: `${issuer}/.well-known/jwks.json`,
          enabled,
          audience: null,
        },
      });
  }

  return {
    acmeId: customerRows["Acme Health"]!.id,
    globexId: customerRows["Globex Clinic"]!.id,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const paIssuer = process.env.PA_ISSUER;
  if (!paIssuer) throw new Error("PA_ISSUER is required");
  try {
    const ids = await seedDatabase(getDb(), paIssuer);
    console.log(`Acme Health id: ${ids.acmeId}`);
    console.log(`Globex Clinic id: ${ids.globexId}`);
  } finally {
    await closeDb();
  }
}
