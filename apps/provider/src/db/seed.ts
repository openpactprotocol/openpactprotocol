import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  appointments,
  aops,
  agentPlatforms,
  customerPlatforms,
  customerUsers,
  customers,
} from "./schema.js";
import { closeDb, getDb, type Db } from "./client.js";

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function randomPublicId(): string {
  const bytes = randomBytes(21);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function upcomingAt(days: number): Date {
  const result = new Date();
  result.setUTCDate(result.getUTCDate() + days);
  result.setUTCHours(10, 0, 0, 0);
  return result;
}

const aopDefinitions = [
  {
    id: "faq",
    name: "Frequently asked questions",
    description: "Answer questions about clinic hours, location, parking, and insurance.",
    channels: ["chat", "voice", "a2a"],
    requiresVerification: false,
    tags: ["hours", "location", "parking", "insurance"],
    examples: ["What are your hours?", "Where are you located?"],
  },
  {
    id: "appointment_lookup",
    name: "Appointment lookup",
    description: "Look up a customer's upcoming appointments after identity verification.",
    channels: ["chat", "voice", "a2a"],
    requiresVerification: true,
    tags: ["appointment", "booking", "schedule"],
    examples: ["When is my next appointment?"],
  },
  {
    id: "appointment_reschedule",
    name: "Appointment rescheduling",
    description: "Reschedule an upcoming appointment after identity verification.",
    channels: ["chat", "voice", "a2a"],
    requiresVerification: true,
    tags: ["reschedule", "appointment", "change"],
    examples: ["I need to move my appointment."],
  },
  {
    id: "billing_dispute",
    name: "Billing disputes",
    description: "Help with billing questions and disputed charges.",
    channels: ["chat"],
    requiresVerification: true,
    tags: ["billing", "dispute", "refund"],
    examples: ["I want to dispute a charge."],
  },
];

type AopDefinition = (typeof aopDefinitions)[number];

async function upsertAop(db: Db, customerId: string, definition: AopDefinition): Promise<void> {
  await db
    .insert(aops)
    .values({ customerId, ...definition })
    .onConflictDoUpdate({
      target: [aops.customerId, aops.id],
      set: {
        name: definition.name,
        description: definition.description,
        channels: definition.channels,
        requiresVerification: definition.requiresVerification,
        tags: definition.tags,
        examples: definition.examples,
      },
    });
}

export async function seedDatabase(
  db: Db,
  paIssuer: string,
): Promise<{ acmeSlug: string; globexSlug: string }> {
  const issuer = paIssuer.replace(/\/+$/, "");
  if (!issuer) throw new Error("PA_ISSUER is required");
  const customerRows: Record<string, typeof customers.$inferSelect> = {};
  for (const [name, suffix, enabled] of [
    ["Acme Health", "acme_health", true],
    ["Globex Clinic", "globex_clinic", false],
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
            a2aEnabled: enabled,
          })
          .returning()
      )[0]!;
    if (customer.a2aEnabled !== enabled) {
      await db.update(customers).set({ a2aEnabled: enabled }).where(eq(customers.id, customer.id));
    }
    customerRows[name] = customer;
  }
  const acme = customerRows["Acme Health"]!;
  const globex = customerRows["Globex Clinic"]!;
  const faqDefinition = aopDefinitions.find((definition) => definition.id === "faq");
  if (!faqDefinition) throw new Error("FAQ AOP definition is missing");
  const customerAops = [
    { customerId: acme.id, definitions: aopDefinitions },
    { customerId: globex.id, definitions: [faqDefinition] },
  ];
  for (const { customerId, definitions } of customerAops) {
    for (const definition of definitions) await upsertAop(db, customerId, definition);
  }

  for (const [email, fullName, dateOfBirth, day] of [
    ["jane.doe@example.com", "Jane Doe", "1990-04-12", 7],
    ["john.smith@example.com", "John Smith", "1985-11-03", 10],
  ] as const) {
    const user =
      (await db.query.customerUsers.findFirst({
        where: and(eq(customerUsers.customerId, acme.id), eq(customerUsers.email, email)),
      })) ??
      (
        await db
          .insert(customerUsers)
          .values({ customerId: acme.id, email, fullName, dateOfBirth })
          .returning()
      )[0]!;
    const appointment = await db.query.appointments.findFirst({
      where: and(eq(appointments.customerUserId, user.id), eq(appointments.customerId, acme.id)),
    });
    if (!appointment) {
      await db.insert(appointments).values({
        customerId: acme.id,
        customerUserId: user.id,
        startsAt: upcomingAt(day),
        providerName: "Dr. Rivera",
        description: "Primary care visit",
        status: "scheduled",
      });
    } else if (appointment.startsAt <= new Date()) {
      await db
        .update(appointments)
        .set({ startsAt: upcomingAt(7) })
        .where(eq(appointments.id, appointment.id));
    }
  }

  const demoIssuer = issuer;
  const disabledIssuer = `${issuer}/disabled-pa`;
  const platformByName: Record<string, typeof agentPlatforms.$inferSelect> = {};
  for (const [name, platformIssuer, enabled] of [
    ["demo-pa", demoIssuer, true],
    ["disabled-pa", disabledIssuer, false],
  ] as const) {
    const platform = (
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
        })
        .returning()
    )[0]!;
    platformByName[name] = platform;
  }
  for (const [customer, platform, allowed] of [
    [acme, platformByName["demo-pa"]!, true],
    [acme, platformByName["disabled-pa"]!, true],
    [globex, platformByName["demo-pa"]!, true],
  ] as const) {
    await db
      .insert(customerPlatforms)
      .values({ customerId: customer.id, platformId: platform.id, allowed })
      .onConflictDoUpdate({
        target: [customerPlatforms.customerId, customerPlatforms.platformId],
        set: { allowed },
      });
  }
  return { acmeSlug: acme.slug, globexSlug: globex.slug };
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
