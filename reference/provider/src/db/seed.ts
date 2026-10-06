import { eq } from "drizzle-orm";
import { closeDb, getDb, type Db } from "./client.js";
import { agentPlatforms, customers } from "./schema.js";

export const DEMO_CUSTOMERS = [
  { name: "Skyline Airways", id: "01M3R53Q5SZQ6FQSMSDBSSREAA" },
  { name: "Loom & Co.", id: "01M3R53Q5WKZ7A0GY4PZ8Y39TB" },
  { name: "Bloom & Stem", id: "01M3R53Q5WHQ1APYDKBW3NCDG3" },
] as const;

export async function seedDatabase(
  db: Db,
  paIssuer: string,
  options: { seedDemoPlatform?: boolean } = {},
): Promise<{ skylineId: string; loomId: string; bloomId: string }> {
  const issuer = paIssuer.replace(/\/+$/, "");
  if (!issuer) throw new Error("PA_ISSUER is required");

  const customerRows: Record<string, typeof customers.$inferSelect> = {};
  for (const { name, id } of DEMO_CUSTOMERS) {
    const existing = await db.query.customers.findFirst({ where: eq(customers.name, name) });
    let customer = existing;
    if (!customer) {
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
    skylineId: customerRows["Skyline Airways"]!.id,
    loomId: customerRows["Loom & Co."]!.id,
    bloomId: customerRows["Bloom & Stem"]!.id,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const paIssuer = process.env.PA_ISSUER;
  if (!paIssuer) throw new Error("PA_ISSUER is required");
  try {
    const ids = await seedDatabase(getDb(), paIssuer);
    console.log(`Skyline Airways id: ${ids.skylineId}`);
    console.log(`Loom & Co. id: ${ids.loomId}`);
    console.log(`Bloom & Stem id: ${ids.bloomId}`);
  } finally {
    await closeDb();
  }
}
