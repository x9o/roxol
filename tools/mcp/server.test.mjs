import assert from "node:assert/strict";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadProofs } from "./proofs.mjs";
import { createRoxolServer } from "./server.mjs";

test("MCP discovers read-only tools and returns source data, cache hits, and proof coverage", async (t) => {
  const assetId = "398674411";
  const postId = "1450000000000000000";
  const link = `https://discord.com/channels/415246288779608064/535250426061258753/${postId}`;
  const file = path.join(await mkdtemp(path.join(tmpdir(), "roxol-mcp-")), "pilot.json");
  t.after(() => rm(file).then(() => rmdir(path.dirname(file))));
  const entry = {
    id: postId, link, date: "2026-11-21", participants: ["Sender", "Receiver"],
    baskets: [[{ kind: "asset", id: assetId, quantity: 2 }], [{ kind: "asset", id: "9", quantity: 1 }]],
    robux: [0, null], hashes: ["f".repeat(64)],
  };
  await writeFile(file, JSON.stringify({ pricedTrades: [{ ...entry, link: "https://example.com/private" }] }));
  await assert.rejects(loadProofs(file), /Invalid reviewed public proof/);
  await writeFile(file, JSON.stringify({ pricedTrades: [entry, { id: "skip", status: "conflict" }] }));
  const proofs = await loadProofs(file);
  assert.equal(proofs.records.length, 1);
  assert.equal("participants" in proofs.records[0], false);

  const originalFetch = globalThis.fetch;
  const urls = [];
  t.mock.method(globalThis, "fetch", (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(init.credentials, "omit");
    urls.push(url.href);
    if (url.hostname === "api.rolimons.com") return Response.json({ success: true, assets: {
      [assetId]: ["Black Iron Antlers", "BIA", 10000, 12000, 12000, 3, 2, -1, -1, -1],
    } });
    if (url.pathname === "/api/public/items") return Response.json({ items: [{
      id: assetId, name: "Black Iron Antlers", rap: 10000, value: 0, copies: 220,
    }] });
    if (url.pathname === "/v1/catalog/items/details") return Response.json({ data: [{
      itemType: "Asset", id: assetId, name: "Black Iron Antlers", recentAveragePrice: 10001, isLimited: true,
    }] });
    if (url.pathname.endsWith("/details")) return Response.json({ CollectibleItemDetails: { CollectibleLowestResalePrice: 12200 } });
    if (url.pathname.startsWith("/item/")) return new Response(null, { status: 403 });
    if (url.pathname.startsWith("/item-value-changes/")) {
      return new Response(`var value_changes = [[1763769600,"${assetId}",1,1,13000,12000]];`);
    }
    if (url.pathname.startsWith("/itemsales/")) {
      return new Response('var item_sales = {"timestamp_list":[1763769600],"sale_price_list":[12345],"sale_rap_list":[12000]};');
    }
    if (url.pathname.endsWith("/resale-data")) {
      const date = "2026-11-21T00:00:00Z";
      const yesterday = "2026-11-20T00:00:00Z";
      const older = "2026-11-19T00:00:00Z";
      return Response.json({ recentAveragePrice: 10100, priceDataPoints: [
        { date, value: 12000 }, { date: yesterday, value: 12100 }, { date: older, value: 11900 },
      ], volumeDataPoints: [{ date, value: 4 }, { date: older, value: 0 }] });
    }
    if (url.pathname.startsWith("/web/item-trades/")) {
      return Response.json({ page: 1, pages: 1, per_page: 20, total: 1, trades: [{
        kind: "trade", trade_id: "example", inferred: false, ts: 1763769600, user_a_id: "private-field",
        side_a_items: [{ asset_id: assetId, rap: 0, value_then: null, quantity: 2 }],
        side_b_items: [{ asset_id: "9", rap: 12100, value_then: 0 }],
      }] });
    }
    throw new Error(`Unexpected fixture URL ${url.href}`);
  });

  const server = createRoxolServer({ proofs }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const endpoint = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const client = new Client({ name: "roxol-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.equal(tools.length, 5);
  assert(tools.every(({ annotations }) => annotations.readOnlyHint === true && annotations.destructiveHint === false));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    return result.structuredContent;
  };

  const [search, stats] = await Promise.all([
    call("find_items", { query: "BIA" }),
    call("get_item_stats", { id: assetId }),
  ]);
  assert.equal(search.items[0].id, assetId);
  assert.equal(stats.rolimons.data.value, 12000);
  assert.equal(stats.routility.data.value, 0);
  assert.equal(stats.roblox.data.rap, 10001);
  assert.equal(stats.rolimonsDailySales.httpStatus, 403);
  assert.equal(urls.filter((url) => url.includes("/itemdetails")).length, 1);
  assert.equal(urls.filter((url) => url.includes("/api/public/items")).length, 1);
  assert.deepEqual((await call("get_item_stats", { id: assetId })).rolimons, stats.rolimons);

  for (const [series, key, value, total] of [
    ["rolimons_sales", "price", 12345, 1], ["rolimons_value_changes", "after", 12000, 1], ["roblox_resale", "volume", 4, 3],
  ]) {
    const data = await call("get_market_history", { id: assetId, series, limit: 1 });
    assert.equal(data.records[0][key], value);
    assert.equal(data.hasMore, total > 1);
    assert.equal(data.total, total);
  }
  const resale = await call("get_market_history", { id: assetId, series: "roblox_resale" });
  assert.deepEqual(resale.records.map(({ volume }) => volume), [4, null, 0]);
  const trades = await call("get_trade_observations", { assetId });
  assert.equal(trades.evidenceType, "ownership_transfer_observation");
  assert.equal(trades.trades[0].inferred, false);
  assert.equal(trades.trades[0].sideA[0].valueThen, null);
  assert.equal(trades.trades[0].sideB[0].valueThen, 0);
  assert.equal("user_a_id" in trades.trades[0], false);
  const { records } = await call("get_trade_proofs", { id: assetId });
  assert.deepEqual(records[0].robux, [0, null]);
  assert.equal(records[0].source, link);
  assert.equal((await call("get_trade_proofs", { id: "999" })).total, 0);
  assert.equal((await client.callTool({ name: "get_item_stats", arguments: { id: "https://example.com" } })).isError, true);
  assert.equal((await originalFetch(endpoint, { method: "POST", headers: { Origin: "https://example.com" } })).status, 403);
});
