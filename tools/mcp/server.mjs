import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { findItems, itemStats, history, tradeObservations, tradeProofs } from "./data.mjs";
import { loadNevosToken, loadProofs } from "./proofs.mjs";

const id = z.string().regex(/^[1-9]\d{0,19}$/).describe("Roblox ID as a decimal string");
const target = { id, kind: z.enum(["asset", "bundle"]).default("asset") };
const page = z.number().int().min(1).max(10_000).default(1);
const limit = z.number().int().min(1).max(50).default(20);
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function createMcp(proofs, nevosToken) {
  const server = new McpServer({ name: "roxol-market-data", version: "1.0.0" }, {
    instructions: "Find item IDs with find_items. Source statuses and timestamps describe each provider independently. " +
      "RoUtility trades are ownership-transfer observations. Nevos proof posts are user-reported. " +
      "The reviewed screenshot export can supply fallback evidence. " +
      "Prices and history use Robux unless a field explicitly names another currency.",
  });

  function register(name, description, input, read) {
    server.registerTool(name, { description, inputSchema: z.strictObject(input), annotations }, async (args) => {
      const data = await read(args);
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    });
  }

  register("find_items", "Find limited assets and bundles by Roblox ID, name, or acronym.",
    { query: z.string().trim().min(1).max(100), limit }, findItems);
  register("get_item_stats", "Get public item statistics by provider, including RAP, assigned Value, demand, supply and best price where available.",
    target, itemStats);
  register("get_market_history", "Get one paginated series of Rolimon's tracked sales, assigned Value changes, or Roblox daily resale prices and volumes. Newest observations first.",
    { ...target, series: z.enum(["rolimons_sales", "rolimons_value_changes", "roblox_resale"]), page, limit },
    ({ id, kind, ...args }) => history({ id, kind }, args));
  register("get_trade_observations", "Get a page of public RoUtility ownership-transfer observations. The feed can infer exchanges and cannot confirm completion or side payments.",
    { assetId: id, page }, tradeObservations);
  register("get_trade_proofs", "Find live Nevos proof posts for an asset, with reviewed screenshot evidence as a fallback. Bundles use the reviewed export.",
    { ...target, page, limit }, ({ id, kind, ...args }) => tradeProofs(proofs, { id, kind }, args, nevosToken));
  return server;
}

export function createRoxolServer({ proofs = null, nevosToken, publicHost } = {}) {
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
    const server = createMcp(proofs, nevosToken);
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
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.ROXOL_MCP_BIND ?? "127.0.0.1";
  const publicHost = process.env.ROXOL_MCP_PUBLIC_HOST;
  const [proofs, nevosToken] = await Promise.all([
    loadProofs(process.env.ROXOL_MCP_PUBLIC_PROOFS), loadNevosToken(process.env.ROXOL_MCP_NEVOS_TOKEN),
  ]);
  createRoxolServer({ proofs, nevosToken, publicHost }).listen(port, host, () => {
    console.log(`Roxol MCP listening at http://${host}:${port}/mcp`);
  });
}
