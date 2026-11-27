import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRoxolServer } from "./server.mjs";

test("MCP ranks Limiteds by price, volume, historical change and discount", async (t) => {
  const day = 86_400_000;
  const midnight = Math.floor(Date.now() / day) * day;
  const dayAt = (daysAgo) => new Date(midnight - daysAgo * day).toISOString();
  const secondsAt = (daysAgo) => (midnight - daysAgo * day) / 1000;
  const uuid = (id) => `00000000-0000-0000-0000-00000000000${id}`;
  const originalFetch = globalThis.fetch;
  const detailBatches = [];
  t.mock.method(globalThis, "fetch", (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    if (url.hostname === "api.rolimons.com") {
      const row = (name, rap, value, projected = -1) => [name, "", rap, value, rap, 4, 2, projected];
      const broad = Object.fromEntries(Array.from({ length: 61 }, (_, index) => [
        100 + index, [`Broad ${index}`, "", 12000, 15000 + index, 12000, 0, 2, -1],
      ]));
      return Response.json({ success: true, assets: {
        1: row("Hat", 125000, 150000),
        2: row("Gear", 125000, 150000),
        3: row("Projected Hat", 125000, 150000, 1),
        4: row("RAP Hat", 125000, -1),
        5: row("Slow Hat", 140000, 200000),
        6: row("Unknown Hat", 125000, 150000),
        ...broad,
      }, bundles: { 1: row("Bundle", 120000, 150000) } });
    }
    if (url.pathname === "/v1/catalog/items/details") {
      const { items } = JSON.parse(init.body);
      detailBatches.push(items.length);
      return Response.json({ data: items.filter(({ id }) => id !== 6).map(({ id, itemType }) => ({
        id, itemType, ...(itemType === "Asset" ? { assetType: id === 2 ? 19 : 8 } : {}),
        collectibleItemId: id < 100 ? uuid(itemType === "Bundle" ? 7 : id) : null,
        lowestResalePrice: id === 5 ? 189000 : itemType === "Bundle" ? 165000 : 142500,
      })) });
    }
    const resaleId = url.pathname.match(/00000000-0000-0000-0000-00000000000(\d)\/resale-data$/)?.[1];
    if (resaleId) {
      const active = resaleId !== "5";
      // One volume-only day must still contribute to the ranking.
      return Response.json({
        priceDataPoints: [{ date: dayAt(2), value: 137000 }],
        volumeDataPoints: [
          { date: dayAt(2), value: active ? 6 : 1 },
          { date: dayAt(3), value: active && resaleId !== "7" ? 2 : 0 },
          { date: dayAt(15), value: active ? 2 : 0 },
          { date: dayAt(0), value: 50 },
        ],
      });
    }
    const sales = url.pathname.match(/^\/(item|bundle)sales\/(\d+)$/);
    if (sales) return new Response(`var item_sales = ${JSON.stringify({
      timestamp_list: [secondsAt(35), secondsAt(3), secondsAt(2)],
      sale_id_list: [1, 2, 3], sale_rap_list: [155000, 150000, 130000], sale_price_list: [155000, 138000, 140000],
    })};`);
    const changes = url.pathname.match(/^\/(item|bundle)-value-changes\/(\d+)$/);
    if (changes) {
      const id = Number(changes[2]);
      const type = changes[1] === "bundle" ? 2 : 1;
      const end = id >= 100 ? 15000 + id - 100 : id === 5 ? 200000 : 150000;
      const start = end - (id >= 100 ? 2000 : 20000);
      return new Response(`var value_changes = ${JSON.stringify([
        [secondsAt(2), id, type, 1, start, end],
        [secondsAt(25), id, type, 1, null, start],
      ])};`);
    }
    assert.match(url.pathname, /^\/v1\/assets\/\d+\/resale-data$/);
    return new Response(null, { status: 503 });
  });

  const server = createRoxolServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const client = new Client({ name: "search-fixture", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
  t.after(() => client.close());
  assert.ok((await client.listTools()).tools.some(({ name }) => name === "search_limiteds"));
  const call = (args) => client.callTool({ name: "search_limiteds", arguments: args });
  const search = async (args) => {
    const response = await call(args);
    assert.equal(response.isError, undefined, JSON.stringify(response.content));
    return response.structuredContent;
  };

  const liquid = await search({ price: { basis: "value", min: 100000, max: 250000 }, demand: ["High", "Amazing"],
    excludeGear: true, excludeProjected: true, sales: { days: 7 } });
  assert.equal(liquid.status, "partial");
  assert.equal(liquid.scope.missingCatalogData, 1);
  assert.deepEqual(liquid.items.map(({ name, sortValue }) => [name, sortValue]), [
    ["Hat", 8], ["Bundle", 6], ["Slow Hat", 1],
  ]);
  assert.equal(liquid.items[0].sales.tracked.medianSalePrice, 139000);
  assert.equal(liquid.items[0].sales.roblox.latestSaleDay, dayAt(2));
  assert.equal(liquid.items[0].sales.tracked.recentSales[0].price, 140000);
  assert.ok(detailBatches.some((size) => size > 1));

  const rising = await search({ demand: ["Amazing"], change: { basis: "value", days: 14, direction: "rising" },
    sort: "change_percent", limit: 1 });
  assert.deepEqual(rising.items[0].change, {
    basis: "value", days: 14, from: rising.items[0].change.from, start: 130000, startEvidenceAt: dayAt(25),
    end: 150000, endObservedAt: rising.sources.rolimons.checkedAt, difference: 20000,
    percent: 100 * 20000 / 130000, source: "https://www.rolimons.com/bundle-value-changes/1",
  });
  assert.equal(rising.items[0].valueHistory.latestChangeAt, dayAt(2));
  assert.equal(rising.items[0].trend, "Stable");

  const dropping = await search({ demand: ["Amazing"], trend: ["Stable"], change: { basis: "rap", days: 30, direction: "falling" },
    sales: { days: 30, minSold: 5 } });
  const hat = dropping.items.find(({ name }) => name === "Hat");
  assert.equal(hat.change.start, 150000);
  assert.equal(hat.change.end, 125000);
  assert.equal(hat.sales.roblox.copiesSold, 10);
  assert.equal(dropping.scope.missingVolumeData, 1);
  assert.equal(dropping.items.some(({ name }) => name === "Slow Hat"), false);

  const discounts = await search({ price: { basis: "lowest_ask", max: 199999 }, minDiscountPercent: 5,
    sales: { days: 30 }, sort: "sales" });
  assert.deepEqual(discounts.items.map(({ name }) => name), ["Gear", "Hat", "Projected Hat", "Slow Hat"]);
  assert.deepEqual(discounts.items[0].discountPercent, 5);
  assert.equal(discounts.items[0].lowestAsk.price, 142500);
  assert.ok(discounts.items[0].lowestAsk.checkedAt);
  const rap = await search({ price: { basis: "rap", max: 125000 } });
  assert.ok(rap.items.some(({ name, value }) => name === "RAP Hat" && value === null));
  assert.equal((await call({ sort: "change" })).isError, true);
  assert.equal((await call({ price: { basis: "value", min: 10, max: 5 } })).isError, true);

  const broad = { demand: ["Terrible"], change: { basis: "value", days: 14, direction: "rising" }, limit: 1 };
  const page = await search(broad);
  assert.equal(page.status, "partial");
  assert.equal(page.matched, 60);
  assert.equal(page.scope.nextCandidateOffset, 60);
  const last = await search({ ...broad, candidateOffset: page.scope.nextCandidateOffset });
  assert.equal(last.scope.nextCandidateOffset, null);
  assert.equal(last.matched, 1);
  assert.equal(last.items[0].name, "Broad 0");
});
