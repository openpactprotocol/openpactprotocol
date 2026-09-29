import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, getDb, type Db } from "./client.js";
import { agentPlatforms, customers } from "./schema.js";

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomPublicId(): string {
  const bytes = randomBytes(21);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function seedDatabase(
  db: Db,
  paIssuer: string,
): Promise<{ acmeSlug: string; globexSlug: string }> {
  const issuer = paIssuer.replace(/\/+$/, "");
  if (!issuer) throw new Error("PA_ISSUER is required");

  const customerRows: Record<string, typeof customers.$inferSelect> = {};
  for (const [name, suffix] of [
    ["Acme Health", "acme_health"],
    ["Globex Clinic", "globex_clinic"],
  ] as const) {
    const existing = await db.query.customers.findFirst({ where: eq(customers.name, name) });
    const publicId = existing ? undefined : randomPublicId();
    const customer =
      existing ??
      (
        await db
          .insert(customers)
          .values({
            publicId: publicId!,
            slug: `${publicId!.slice(-7)}_${suffix}`,
            name,
          })
          .returning()
      )[0]!;
    customerRows[name] = customer;
  }

  const demoIssuer = issuer;
  const disabledIssuer = `${issuer}/disabled-pa`;
  for (const [name, platformIssuer, enabled] of [
    ["demo-pa", demoIssuer, true],
    ["disabled-pa", disabledIssuer, false],
  ] as const) {
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
