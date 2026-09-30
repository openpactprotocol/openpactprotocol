import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { getDb, closeDb } from "./client.js";

try {
  await migrate(getDb() as unknown as PostgresJsDatabase<typeof schema>, {
    migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
  });
} finally {
  await closeDb();
}
