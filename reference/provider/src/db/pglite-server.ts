import { homedir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number.parseInt(process.env.PGLITE_PORT ?? "5432", 10);
const dataDir =
  process.env.PGLITE_DATA_DIR ?? join(homedir(), ".local", "share", "pact-provider-db");
const db = await PGlite.create(dataDir);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 10 });
await server.start();
console.log(`PGlite PostgreSQL server listening on 127.0.0.1:${port} (${dataDir})`);

async function stop(): Promise<void> {
  await server.stop();
  await db.close();
  process.exit(0);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
