import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { copyHistory, findItems, itemStats, history, tradeObservations, tradeProofs } from "./data.mjs";
import targets from "../../extension/shared/market_targets.js";
import { createFaceAliases, createProofClient, loadProofs, proofImage } from "./proofs.mjs";
import { createScreenshotIndex } from "./proof-screenshots.mjs";
import { tradeContext, tradeContextInput } from "./trade-context.mjs";
import { searchLimiteds, searchLimitedsInput } from "./search-limiteds.mjs";

const id = z.string().regex(/^[1-9]\d{0,19}$/).describe("Roblox ID as a decimal string");
const collectibleInstanceId = z.string().trim().refine((value) => targets.copyIdOf(value) && !targets.idOf(value),
  "Provide a collectible instance UUID.").transform((value) => value.toLowerCase())
  .describe("Collectible item instance ID (CIIID) as a UUID");
const kind = z.enum(["asset", "bundle"]);
const target = { id, kind: kind.default("asset") };
const query = z.string().trim().min(1).max(100);
const page = z.number().int().min(1).max(10_000).default(1);
const limit = z.number().int().min(1).max(50).default(20);
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function createMcp(proofs, readLiveProofs, proofOptions, instanceId) {
  const server = new McpServer({ name: "roxol-market-data", version: "1.0.0" }, {
    instructions: "Find item IDs with find_items. Source statuses and timestamps describe each provider independently. " +
      "RoUtility trades are ownership-transfer observations. Nevos proof posts are user-reported. " +
      "Use get_trade_proof_image to view a Nevos attachment from get_trade_proofs. The optional readScreenshots flag transcribes and indexes both sides when server-side vision is configured. Label proof W/L by its screenshot price field and leave any null fee-adjusted result unknown. " +
      "Prices and history use Robux unless a field explicitly names another currency.",
  });

  function register(name, description, inputSchema, read, { includeText = true, readOnly = true } = {}) {
    server.registerTool(name, { description, inputSchema, annotations: { ...annotations, readOnlyHint: readOnly } }, async (args) => {
      const data = await read(args);
      return { content: includeText ? [{ type: "text", text: JSON.stringify(data) }] : [], structuredContent: data };
    });
  }

  register("find_items", "Find limited assets and bundles by Roblox ID, name, or acronym.",
    z.strictObject({ query, limit }), findItems);
  register("search_limiteds", "Rank Roblox Limiteds by assigned Rolimon's Value, RAP, Roblox lowest resale ask, demand, 7- or 30-day sales volume, measured Value or RAP change, or discount to Value. Filter by price, demand, trend, gear, projected status, volume, change direction or minimum discount. Returns recent sale evidence and the inputs to each rank. Check scope.changeGaps for unevaluated items. If scope.retryAt is set, rerun the same page at or after that UTC time and use the refreshed result before advancing to nextCandidateOffset.",
    searchLimitedsInput, searchLimiteds);
  register("get_item_stats", "Get public item statistics by provider, including RAP, assigned Value, demand, supply and best price where available.",
    z.strictObject(target), itemStats);
  register("get_trade_context", "Gather market statistics, sales and trade proofs for an entire Roblox Limiteds trade, with optional tracked ownership for identified copies. Give and receive are from your perspective. Provide both baskets for nominal received-minus-given RAP and Value. A trade ID alone requires a signed-in Roblox session.",
    tradeContextInput, (args) => tradeContext(args, proofs, readLiveProofs, proofOptions), { includeText: false });
  register("get_market_history", "Get one paginated series of Rolimon's tracked sales, assigned Value changes, or Roblox daily resale prices and volumes. Newest observations first. When Value history is rate_limited, retry at or after retryAt.",
    z.strictObject({ ...target, series: z.enum(["rolimons_sales", "rolimons_value_changes", "roblox_resale"]), page, limit }),
    ({ id, kind, ...args }) => history({ id, kind }, args));
  register("get_trade_observations", "Get a page of public RoUtility ownership-transfer observations. The feed can infer exchanges and cannot confirm completion or side payments.",
    z.strictObject({ assetId: id, page }), tradeObservations);
  register("get_copy_history", "Get tracked ownership observations for one Roblox Limited copy by UAID or collectible instance UUID, newest first. Use as evidence for poisoning-risk assessment. Tracker coverage can have gaps and ownership history alone cannot establish theft or confirm a copy is safe.",
    z.strictObject({ uaid: id.optional(), collectibleInstanceId: collectibleInstanceId.optional(), page, limit })
      .refine(({ uaid, collectibleInstanceId }) => Boolean(uaid) !== Boolean(collectibleInstanceId),
        "Provide either uaid or collectibleInstanceId."), copyHistory);
  register("get_trade_proofs", "Find public trade proof posts by item ID, name, or acronym, including indexed screenshots and equivalent legacy face or bundle IDs.",
    z.strictObject({ id: id.optional(), query: query.optional(), kind: kind.optional(), page, limit,
      readScreenshots: z.boolean().default(false).describe("Read both offers, Robux and the difference after fees from the page's Nevos screenshots, and index completed trades across all their items. Requires server-side vision configuration."),
      screenshotOffset: z.number().int().min(0).max(10_000).default(0)
        .describe("Zero-based attachment offset within this page. Advance by 12 to read the next batch of screenshots.") })
      .refine(({ id, query }) => Boolean(id) !== Boolean(query), "Provide either id or query."),
    async ({ id: itemId, query, kind, ...args }) => {
      const numericId = itemId ?? id.safeParse(query).data;
      let item = { id: numericId, kind: kind ?? "asset" };
      if (!numericId) {
        const search = await findItems({ query, kind, limit: 1 });
        [item] = search.items;
        if (!item) return { instanceId, query, status: search.status === "ok" ? "not_found" : search.status, sources: search.sources };
      }
      return { instanceId, ...await tradeProofs(proofs, { id: item.id, kind: item.kind },
        { ...args, inferKind: Boolean(numericId && !kind), itemName: item.name }, readLiveProofs, proofOptions) };
    }, { readOnly: false });
  server.registerTool("get_trade_proof_image", {
    description: "View one original trade proof screenshot using a Nevos attachment URL returned by get_trade_proofs. Returns the picture as MCP image content.",
    inputSchema: z.strictObject({ attachment: z.string().regex(proofImage)
      .describe("Nevos attachment URL from get_trade_proofs.") }),
    annotations,
  }, async ({ attachment }) => {
    const image = await readLiveProofs.readImage?.(attachment).catch(() => null);
    if (!image) {
      return { content: [{ type: "text", text: "Nevos did not return a readable image for this attachment." }],
        structuredContent: { attachment, status: "unavailable" } };
    }

    const mimeType = `image/${image.mime}`;
    return { content: [{ type: "image", data: image.bytes.toString("base64"), mimeType }],
      structuredContent: { attachment, status: "ok", mimeType } };
  });
  return server;
}

export function createRoxolServer({ proofs = null, publicHost, proofEnv = process.env,
  readLiveProofs = createProofClient(proofEnv), readAliases = createFaceAliases(), screenshots } = {}) {
  const instanceId = randomUUID();
  const proofOptions = { readAliases, screenshots };
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
    const server = createMcp(proofs, readLiveProofs, proofOptions, instanceId);
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
  const readLiveProofs = createProofClient();
  const readAliases = createFaceAliases();
  const [proofs, screenshots] = await Promise.all([
    loadProofs(process.env.ROXOL_MCP_PUBLIC_PROOFS),
    createScreenshotIndex({
      env: { ROXOL_PROOF_INDEX_DIR: fileURLToPath(new URL(".proof-screenshots", import.meta.url)), ...process.env },
      readImage: readLiveProofs.readImage, readAliases,
    }),
  ]);
  createRoxolServer({ proofs, publicHost, readLiveProofs, readAliases, screenshots }).listen(port, host, () => {
    console.log(`Roxol MCP listening at http://${host}:${port}/mcp`);
  });
}
