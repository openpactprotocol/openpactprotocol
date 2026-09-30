import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let connection: postgres.Sql | undefined;
let database: Db | undefined;

export function getDb(): Db {
  if (!database) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    const poolSize = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "5", 10);
    connection = postgres(url, { prepare: false, max: poolSize });
    database = drizzle(connection, { schema });
  }
  return database;
}

export async function closeDb(): Promise<void> {
  await connection?.end();
  connection = undefined;
  database = undefined;
}
