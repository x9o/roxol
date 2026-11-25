import { createServer } from "node:http";
import path from "node:path";
import { dataDir, readJson } from "./store.mjs";

const snapshotFile = path.join(dataDir, "benchmarks.json");
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  const match = /^\/v1\/items\/(asset|bundle)\/([1-9]\d{0,19})$/.exec(request.url);
  if (request.method !== "GET" || !match) {
    response.writeHead(404).end(JSON.stringify({ status: "not-found" }));
    return;
  }
  try {
    const snapshot = await readJson(snapshotFile, null);
    if (!snapshot || snapshot.version !== 1) throw new Error("Benchmark snapshot unavailable");
    const [, kind, id] = match;
    const groups = snapshot.items[kind + ":" + id] ?? {};
    response.end(JSON.stringify({
      version: 1, kind, id, lastCollection: snapshot.lastCollection, generatedAt: snapshot.generatedAt, groups,
    }));
  } catch {
    response.writeHead(503).end(JSON.stringify({ status: "unavailable" }));
  }
});
server.listen(43127, "127.0.0.1", () => console.log("Roxol benchmarks listening on http://127.0.0.1:43127"));
