import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { findItems, itemStats, history, tradeObservations, tradeProofs } from "./data.mjs";
import { createProofClient, loadProofs } from "./proofs.mjs";

const id = z.string().regex(/^[1-9]\d{0,19}$/).describe("Roblox ID as a decimal string");
const kind = z.enum(["asset", "bundle"]);
const target = { id, kind: kind.default("asset") };
const query = z.string().trim().min(1).max(100);
const page = z.number().int().min(1).max(10_000).default(1);
const limit = z.number().int().min(1).max(50).default(20);
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function createMcp(proofs, readLiveProofs) {
  const server = new McpServer({ name: "roxol-market-data", version: "1.0.0" }, {
    instructions: "Find item IDs with find_items. Source statuses and timestamps describe each provider independently. " +
      "RoUtility trades are ownership-transfer observations. Nevos proof posts are user-reported. " +
      "The reviewed screenshot export can supply fallback evidence. " +
      "Prices and history use Robux unless a field explicitly names another currency.",
  });

  function register(name, description, inputSchema, read) {
    server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
      const data = await read(args);
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    });
  }

  register("find_items", "Find limited assets and bundles by Roblox ID, name, or acronym.",
    z.strictObject({ query, limit }), findItems);
  register("get_item_stats", "Get public item statistics by provider, including RAP, assigned Value, demand, supply and best price where available.",
    z.strictObject(target), itemStats);
  register("get_market_history", "Get one paginated series of Rolimon's tracked sales, assigned Value changes, or Roblox daily resale prices and volumes. Newest observations first.",
    z.strictObject({ ...target, series: z.enum(["rolimons_sales", "rolimons_value_changes", "roblox_resale"]), page, limit }),
    ({ id, kind, ...args }) => history({ id, kind }, args));
  register("get_trade_observations", "Get a page of public RoUtility ownership-transfer observations. The feed can infer exchanges and cannot confirm completion or side payments.",
    z.strictObject({ assetId: id, page }), tradeObservations);
  register("get_trade_proofs", "Find live Nevos proof posts by item ID or by a name or acronym query such as SKOTN. Bundles and unavailable live results use the reviewed export.",
    z.strictObject({ id: id.optional(), query: query.optional(), kind: kind.optional(), page, limit })
      .refine(({ id, query }) => Boolean(id) !== Boolean(query), "Provide either id or query."),
    async ({ id: itemId, query, kind, ...args }) => {
      const numericId = itemId ?? id.safeParse(query).data;
      if (numericId) return tradeProofs(proofs, { id: numericId, kind: kind ?? "asset" }, args, readLiveProofs);

      const search = await findItems({ query, kind, limit: 1 });
      const [item] = search.items;
      if (!item) return { query, status: search.status === "ok" ? "not_found" : search.status, sources: search.sources };
      return tradeProofs(proofs, { id: item.id, kind: item.kind }, args, readLiveProofs);
    });
  return server;
}

export function createRoxolServer({ proofs = null, publicHost, proofEnv = process.env } = {}) {
  const readLiveProofs = createProofClient(proofEnv);
  const allowedHosts = new Set(["127.0.0.1", "localhost", publicHost?.toLowerCase()].filter(Boolean));
  const allowedOrigins = new Set(["https://chatgpt.com", "https://chat.openai.com"]);
  if (publicHost) allowedOrigins.add(`https://${publicHost.toLowerCase()}`);
  return createServer(async (req, res) => {
    const host = req.headers.host?.toLowerCase().replace(/:\d+$/, "");
    if (!allowedHosts.has(host) || (req.headers.origin && !allowedOrigins.has(req.headers.origin))) {
      res.writeHead(403).end();
      return;
    }
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      // The stateless endpoint has no standalone SSE stream or session to delete.
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    const server = createMcp(proofs, readLiveProofs);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once("close", () => void server.close());
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("MCP request failed", error.message);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      if (!res.writableEnded) res.end(JSON.stringify({
        jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error" },
      }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(new URL(".env", import.meta.url));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.ROXOL_MCP_BIND ?? "127.0.0.1";
  const publicHost = process.env.ROXOL_MCP_PUBLIC_HOST;
  const proofs = await loadProofs(process.env.ROXOL_MCP_PUBLIC_PROOFS);
  createRoxolServer({ proofs, publicHost }).listen(port, host, () => {
    console.log(`Roxol MCP listening at http://${host}:${port}/mcp`);
  });
}
