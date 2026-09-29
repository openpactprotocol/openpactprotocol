import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("./public/.well-known/jwks.json", import.meta.url));
const server = createServer(async (request, response) => {
  if (request.method !== "GET" || request.url !== "/.well-known/jwks.json") {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(file);
    response
      .writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      })
      .end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
server.listen(Number(process.env.PORT ?? 3002), "127.0.0.1", () => {
  console.log(`PA JWKS server listening on http://localhost:${Number(process.env.PORT ?? 3002)}`);
});
