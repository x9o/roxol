import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { tradeProofs } from "./data.mjs";
import { createFaceAliases, createNevosProofClient, loadProofs, proofRobux } from "./proofs.mjs";
import { createDiscordProofClient } from "./discord-proofs.mjs";
import { createScreenshotIndex } from "./proof-screenshots.mjs";
import { createRoxolServer } from "./server.mjs";

test("MCP discovers tools and returns source data, cache hits, and proof coverage", async (t) => {
  const assetId = "439945661";
  const biaId = "398674411";
  const biaName = "Black Iron Antlers";
  const biaPostIds = Array.from({ length: 31 }, (_, index) => String(1450000000000000000n + BigInt(index)));
  const uaid = "9007199254740993";
  const collectibleInstanceId = "c90b0e8f-45ce-4cb9-9a4c-9f68cce9b3f9";
  const proofToken = "fixture-token";
  const postId = "1450000000000000000";
  const link = `https://discord.com/channels/415246288779608064/535250426061258753/${postId}`;
  const channelId = "535250426061258753";
  const newerId = "1450000001000000000";
  const imageId = "1500000000000000001";
  const partialId = "1500000000000000002";
  const unavailableId = "1500000000000000003";
  const reference = (post, image) => `discord-attachment:${post}:${image}`;
  const cdnUrl = (image) => `https://cdn.discordapp.com/attachments/${channelId}/${image}/proof.png?ex=mock`;
  const attachment = reference(postId, imageId);
  const partialAttachment = reference(newerId, partialId);
  const unavailableAttachment = reference(newerId, unavailableId);
  const tradeCaption = "SKOTN / Other Limited\nTrade screenshot";
  const indexDirectory = await mkdtemp(path.join(tmpdir(), "roxol-screenshot-index-"));
  t.after(async () => {
    await rm(path.join(indexDirectory, `${postId}-discord-${imageId}.json`), { force: true });
    await rm(path.join(indexDirectory, `${postId}-123456.json`), { force: true });
    await rmdir(indexDirectory);
  });
  const file = path.join(await mkdtemp(path.join(tmpdir(), "roxol-mcp-")), "pilot.json");
  t.after(() => rm(file).then(() => rmdir(path.dirname(file))));
  const entry = {
    id: postId, link, date: "2026-11-21", participants: ["Sender", "Receiver"],
    baskets: [[{ kind: "asset", id: assetId, quantity: 2 }], [{ kind: "asset", id: "9", quantity: 1 }]],
    robux: [0, null], hashes: ["f".repeat(64)],
  };
  await writeFile(file, JSON.stringify({ pricedTrades: [{ ...entry, link: "https://example.com/private" }] }));
  await assert.rejects(loadProofs(file), /Invalid reviewed public proof/);
  await writeFile(file, JSON.stringify({ pricedTrades: [
    { ...entry, date: "2026-11-20", robux: [10, null] }, entry, { id: "skip", status: "conflict" },
  ] }));
  const proofs = await loadProofs(file);
  assert.equal(proofs.records.length, 2);
  assert.equal("participants" in proofs.records[0], false);

  const originalFetch = globalThis.fetch;
  const urls = [];
  let discordFailure = null;
  let visionRequests = 0;
  let imageStatus = "completed";
  t.mock.method(globalThis, "fetch", (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    urls.push(url.href);
    if (url.hostname === "cdn.discordapp.com") {
      assert.equal(init.headers, undefined);
      assert.equal(init.credentials, "omit");
      if (url.href === cdnUrl(imageId) || url.href === cdnUrl(partialId)) {
        return new Response(Buffer.from("89504e470d0a1a0a", "hex"));
      }
      assert.equal(url.href, cdnUrl(unavailableId));
      return Response.json({ ok: true });
    }
    if (url.hostname === "api.openai.com") {
      visionRequests++;
      const request = JSON.parse(init.body);
      assert.equal(request.store, false);
      assert.match(request.input[0].content[0].image_url, /^data:image\/png;base64,/);
      assert.equal(init.headers.Authorization, "Bearer fixture-vision");
      const item = (name, rap, value, extra = {}) => ({
        name, id: null, kind: null, quantity: 1, serial: null, rap, value, displayedPrice: rap, ...extra,
      });
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text",
        text: JSON.stringify({
          status: imageStatus,
          sideA: { items: [item("Silver King of the Night", 10000, null, { quantity: 2 })],
            itemTotals: { rap: null, value: 24000, displayedPrice: 20000 },
            robux: { amount: 20, basis: "offered" } },
          sideB: { items: [item("Fixture Face", 14000, 15000), item("OL", 8000, 10000, { serial: "3" })],
            itemTotals: { rap: 22000, value: null, displayedPrice: null },
            robux: { amount: 100, basis: "offered" } },
        }) }] }] });
    }
    if (url.hostname === "discord.com") {
      const term = url.searchParams.get("content");
      const offset = Number(url.searchParams.get("offset"));
      assert.equal(url.pathname, "/api/v9/guilds/415246288779608064/messages/search");
      assert.equal(url.searchParams.get("channel_id"), channelId);
      assert.equal(init.headers.Authorization, proofToken);
      assert.equal(init.redirect, "error");
      const result = (rows, count = rows.length) => Response.json({ total_results: count,
        messages: rows.map((row) => [{ channel_id: channelId, hit: true, ...row }]) });
      if (["BIA", biaName].includes(term)) {
        const ids = (term === "BIA" ? biaPostIds.toReversed() : biaPostIds.slice(0, 2)).map((id) => ({ id, content: "BIA" }));
        return result(ids.slice(offset, offset + 25), ids.length);
      }
      if (discordFailure === "timeout") throw new DOMException("Timed out", "TimeoutError");
      if (discordFailure === "network") throw new TypeError("Fetch failed");
      if (discordFailure === "403") return Response.json({ error: proofToken }, { status: 403 });
      if (discordFailure === "429") return new Response(null, { status: 429, headers: { "Retry-After": "120" } });
      if (discordFailure === "invalid") return Response.json({ unexpected: true });
      if (discordFailure === "empty" || ["OL", "Fixture Face"].includes(term)) return result([]);
      assert.ok(["SKOTN", "Silver King of the Night", "Other Limited"].includes(term), term);
      return result([
        { id: postId, content: tradeCaption, attachments: [{ url: cdnUrl(imageId) }, { url: "https://example.com/offsite" }] },
        { id: newerId, timestamp: "2026-11-22T01:00:00.000Z", content: tradeCaption,
          attachments: [{ url: cdnUrl(partialId) }, { url: cdnUrl(unavailableId) }] },
      ]);
    }
    assert.equal(init.credentials, "omit");
    if (url.pathname === "/items/v1/faceassetbundlemap") {
      return Response.json({ face_asset_bundle_map: { "44444": 12345 } });
    }
    if (url.hostname === "api.rolimons.com") return Response.json({ success: true, assets: {
      [assetId]: ["Silver King of the Night ", "SKOTN", 10000, 12000, 12000, 3, 2, -1, -1, -1],
      [biaId]: [biaName, "BIA", 10000, 12000, 12000, 3, 2, -1, -1],
      "9": ["Other Limited", "OL", 22000, -1, 22000, 3, 2, -1, -1, -1],
      "10": ["OL", "", 31000, 33000, 33000, 3, 2, -1, -1, -1],
    }, bundles: { "12345": ["Fixture Face", "", 14000, 15000, 15000, 3, 2, -1, -1, -1] } });
    if (url.pathname === "/api/public/items") return Response.json({ items: [{
      id: assetId, name: "Silver King of the Night", rap: 10000, value: 0, copies: 220,
    }] });
    if (url.pathname === "/v1/catalog/items/details") return Response.json({ data: [{
      itemType: "Asset", id: assetId, name: "Silver King of the Night", recentAveragePrice: 10001, isLimited: true,
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
      if (url.pathname.includes("/777/")) return new Response(null, { status: 404 });
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
    if (url.hostname === "routility.io") {
      if (url.pathname === "/web/uaid/777") return new Response(null, { status: 404 });
      if (url.pathname === "/web/uaid/888") return new Response(null, { status: 429 });
      const copy = {
        uaid, ciid: collectibleInstanceId, item_id: assetId, item_name: "Silver King of the Night", serial: 42,
        current_owner: { ts_sec: 1763769600, player_id: null, player_name: null, is_hidden: true },
        owners: [
          { ts_sec: 1763683200, player_id: "9007199254740995", player_name: "EarlierOwner", _prev: true },
          { ts_sec: 1763769600, player_id: null, player_name: null, avatar: "ignored" },
          { ts_sec: 1763683200, player_id: "9876", player_name: "LaterOwner" },
        ],
        flips: [{ ignored: true }],
      };
      if (url.pathname === `/web/uaid/${uaid}` || url.pathname === `/web/ciiid/${collectibleInstanceId}`) {
        return Response.json(copy);
      }
      if (url.pathname === "/web/uaid/999") return Response.json(copy);
    }
    throw new Error(`Unexpected fixture URL ${url.href}`);
  });

  const readAliases = createFaceAliases();
  const readLiveProofs = createDiscordProofClient({ ROXOL_DISCORD_TOKEN: proofToken }, { cacheMs: 0 });
  const screenshotOptions = { env: { ROXOL_PROOF_VISION_KEY: "fixture-vision", ROXOL_PROOF_INDEX_DIR: indexDirectory },
    readAliases, readImage: readLiveProofs.readImage };
  const screenshots = await createScreenshotIndex(screenshotOptions);
  const server = createRoxolServer({ proofs, readLiveProofs, readAliases, screenshots }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const endpoint = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const client = new Client({ name: "roxol-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.equal(tools.length, 9);
  const proofChannelName = "`value-requests` channel in Rolimon's official Discord";
  assert.ok(client.getInstructions().includes(proofChannelName));
  for (const name of ["get_trade_proofs", "get_trade_context", "get_trade_proof_image"]) {
    assert.ok(tools.find((tool) => tool.name === name).description.includes(proofChannelName));
  }
  assert(tools.every(({ name, annotations }) => annotations.readOnlyHint === (name !== "get_trade_proofs") &&
    annotations.destructiveHint === false));
  await readLiveProofs({ id: assetId, kind: "asset" });
  const viewProof = (attachment) => client.callTool({ name: "get_trade_proof_image", arguments: { attachment } });
  const image = await viewProof(attachment);
  assert.deepEqual(image.structuredContent, { attachment, status: "ok", mimeType: "image/png" });
  assert.deepEqual(image.content, [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }]);
  const unavailable = await viewProof(unavailableAttachment);
  assert.equal(unavailable.structuredContent.status, "unavailable");
  assert.equal(unavailable.content[0].type, "text");
  const offsite = "https://example.com/api/proofs/images/123456";
  assert.equal((await viewProof(offsite)).isError, true);
  assert.equal(urls.includes(offsite), false);
  assert.equal(visionRequests, 0);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined);
    if (name === "get_trade_context") assert.deepEqual(result.content, []);
    else assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    return result.structuredContent;
  };

  const [search, stats] = await Promise.all([
    call("find_items", { query: "SKOTN" }),
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

  const [copyByUaid, copyByInstance] = await Promise.all([
    call("get_copy_history", { uaid, limit: 1 }),
    call("get_copy_history", { collectibleInstanceId: collectibleInstanceId.toUpperCase() }),
  ]);
  assert.deepEqual(copyByUaid.copy, {
    uaid, collectibleInstanceId, assetId, name: "Silver King of the Night", serial: "42",
  });
  assert.deepEqual(copyByInstance.copy, copyByUaid.copy);
  assert.equal(copyByUaid.source, `https://routility.io/web/uaid/${uaid}`);
  assert.equal(copyByInstance.source, `https://routility.io/web/ciiid/${collectibleInstanceId}`);
  assert.equal(copyByUaid.total, 3);
  assert.equal(copyByUaid.hasMore, true);
  assert.deepEqual(copyByUaid.records, [{ at: "2025-11-22T00:00:00.000Z", hidden: true }]);
  assert.deepEqual(copyByUaid.currentOwner, copyByUaid.records[0]);
  const nextCopyPage = await call("get_copy_history", { uaid, page: 2, limit: 1 });
  assert.deepEqual(nextCopyPage.records, [{
    at: "2025-11-21T00:00:00.000Z", ownerId: "9007199254740995", username: "EarlierOwner", previousOwner: true,
  }]);
  assert.equal(copyByInstance.hasMore, false);
  assert.equal(copyByInstance.records.length, 3);
  assert.equal(urls.filter((url) => url === copyByUaid.source).length, 1);
  assert.equal((await call("get_copy_history", { uaid: "777" })).status, "not_found");
  assert.equal((await call("get_copy_history", { uaid: "888" })).httpStatus, 429);
  assert.equal((await call("get_copy_history", { uaid: "999" })).status, "unavailable");
  const callsBeforeInvalid = urls.length;
  for (const args of [{}, { uaid, collectibleInstanceId }, { collectibleInstanceId: uaid }, { uaid: 42 },
    { uaid, limit: 51 }]) {
    const result = await client.callTool({ name: "get_copy_history", arguments: args });
    assert.equal(result.isError, true);
  }
  assert.equal(urls.length, callsBeforeInvalid);

  const biaLookup = { query: "BIA", limit: 30 };
  const biaSearches = () => urls.filter((url) => url.includes("discord.com/api/")).map((url) => {
    const params = new URL(url).searchParams;
    return [params.get("content"), params.get("offset")];
  });
  const biaFirst = await call("get_trade_proofs", biaLookup);
  assert.deepEqual(biaSearches().slice(-3), [["BIA", "0"], ["BIA", "25"], [biaName, "0"]]);
  assert.deepEqual(biaFirst.records.map(({ postId }) => postId), biaPostIds.slice(1).reverse());
  assert.equal(biaFirst.providerCount, 31);
  assert.equal(biaFirst.hasMore, true);
  const biaSecond = await call("get_trade_proofs", { ...biaLookup, page: 2 });
  assert.deepEqual(biaSecond.records.map(({ postId }) => postId), [biaPostIds[0]]);
  assert.equal(biaSecond.hasMore, false);

  const proofArgs = { id: assetId };
  const live = await call("get_trade_proofs", { query: " SKOTN ", limit: 1 });
  assert.match(live.instanceId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(live.item, { id: assetId, kind: "asset" });
  assert.equal(live.evidenceType, "discord_proof_post");
  assert.deepEqual(live.proofOrigin, { name: proofChannelName, url: link.slice(0, link.lastIndexOf("/")) });
  assert.equal(live.providerCount, 2);
  assert.equal(live.total, 2);
  assert.equal(live.hasMore, true);
  assert.equal(live.records[0].postId, "1450000001000000000");
  assert.equal(live.records[0].content, tradeCaption);
  const older = await call("get_trade_proofs", { ...proofArgs, limit: 1, page: 2 });
  assert.equal(older.hasMore, false);
  assert.equal(older.records[0].postId, postId);
  assert.equal(older.records[0].discordUrl, link);
  assert.equal(older.records[0].content, tradeCaption);
  assert.deepEqual(older.records[0].attachments, [attachment]);

  const parsed = await call("get_trade_proofs", { ...proofArgs, readScreenshots: true, limit: 1, page: 2 });
  const [screenshot] = parsed.records[0].screenshots;
  assert.equal(screenshot.status, "indexed");
  assert.equal(screenshot.priceBasis, "screenshot");
  assert.equal(screenshot.baskets[0][0].quantity, 2);
  assert.deepEqual(screenshot.baskets[1].map(({ kind, id }) => [kind, id]), [["bundle", "12345"], ["asset", "10"]]);
  assert.equal(screenshot.baskets[1][1].serial, "3");
  assert.deepEqual(screenshot.afterFees, {
    robux: [
      { amount: 20, basis: "offered", offered: 20, credited: 14 },
      { amount: 100, basis: "offered", offered: 100, credited: 70 },
    ],
    netRobux: [50, -86], creditedDifference: 56, netRap: [2050, -2086], netValue: [1050, -1086],
    netDisplayedPrice: [2050, -2086],
  });
  for (const lookup of [{ id: "10" }, { id: "44444" }, { kind: "bundle", id: "12345" },
    { id: "12345" }, { query: "12345" }]) {
    const result = await call("get_trade_proofs", lookup);
    assert.equal(result.discord.status, "ok");
    assert.equal(result.total, 1);
    assert.deepEqual(result.records[0].screenshots, [screenshot]);
  }
  await call("get_trade_proofs", { ...proofArgs, readScreenshots: true, limit: 1, page: 2 });
  assert.equal(visionRequests, 1);
  imageStatus = "incomplete";
  const partial = await screenshots.read(live.records[0], partialAttachment);
  assert.equal(partial.status, "incomplete");
  assert.equal(partial.afterFees, undefined);
  assert.deepEqual(screenshots.forPost(postId), [screenshot]);
  const reloaded = await createScreenshotIndex(screenshotOptions);
  const restored = await tradeProofs(null, { kind: "asset", id: "44444" }, { page: 1, limit: 1 },
    readLiveProofs, { readAliases: async () => null, screenshots: reloaded });
  assert.deepEqual(restored.records[0].screenshots, [screenshot]);
  const saved = JSON.parse(await readFile(path.join(indexDirectory, `${postId}-discord-${imageId}.json`), "utf8"));
  const legacyAttachment = "https://nevos-extension.com/api/proofs/images/123456";
  await writeFile(path.join(indexDirectory, `${postId}-123456.json`), JSON.stringify({ ...saved, attachment: legacyAttachment }));
  const migrated = await createScreenshotIndex(screenshotOptions);
  assert.deepEqual(migrated.forPost(postId), [{ ...screenshot, attachment: legacyAttachment }, screenshot]);

  const context = await call("get_trade_context", {
    give: { items: ["SKOTN", { query: "Silver King of the Night", uaid }], robux: 100 },
    receive: { items: ["9"], robux: 300 }, tradeId: "123", proofLimit: 2, ownershipLimit: 2,
  });
  const givenKey = `asset:${assetId}`;
  assert.deepEqual(Object.keys(context.items), [givenKey, "asset:9"]);
  assert.equal(context.give.totalRap, 20100);
  assert.equal(context.give.totalValue, 24100);
  assert.equal(context.receive.effectiveRobux, 210);
  assert.equal(context.receive.totalValue, 22210);
  assert.deepEqual(context.nominalWL, { rap: 2110, value: -1890 });
  assert.equal(context.items["asset:9"].valueBasis, "rap");
  assert.equal(context.items[givenKey].sales.records[0].price, 12345);
  assert.equal(context.items[givenKey].robloxResale.records[0].volume, 4);
  assert.equal(context.sources[context.items[givenKey].sources.rolimonsDailySales].httpStatus, 403);
  assert.equal(context.items[givenKey].sources.rolimons, context.items["asset:9"].sources.rolimons);
  assert.equal(context.give.items[0].copy, undefined);
  assert.equal(context.give.items[1].copy.collectibleInstanceId, collectibleInstanceId);
  assert.equal(context.ownership[uaid].records.filter(({ hidden }) => hidden).length, 1);
  assert.equal(context.ownership[uaid].records[0].current, true);
  assert.equal(context.ownership[uaid].hasMore, true);
  assert.equal(context.ownership[uaid].records.length, 2);
  assert.equal(context.sources[context.tradeLookup].reason, "requires_authorized_roblox_session");
  assert.equal(Object.keys(context.proofs).length, 2);
  assert.deepEqual(context.proofOrigin, live.proofOrigin);
  assert.equal(context.proofs[postId].discordUrl, link);
  assert.deepEqual(context.proofs[postId].screenshots, [screenshot]);
  assert.deepEqual(context.items[givenKey].proofs.postIds, context.items["asset:9"].proofs.postIds);

  const byCopy = await call("get_trade_context", {
    give: { items: [{ collectibleInstanceId }] }, receive: { items: [{ query: "OL" }] }, proofLimit: 0,
  });
  assert.equal(byCopy.give.items[0].item, givenKey);
  assert.equal(byCopy.give.items[0].copy.uaid, uaid);
  assert.equal(byCopy.receive.items[0].resolution, "ambiguous");
  assert.equal(byCopy.nominalWL.rap, null);
  assert.equal(byCopy.ownership, undefined);
  assert.equal(byCopy.proofs, undefined);

  const mismatch = await call("get_trade_context", {
    give: { items: [{ id: "9", uaid }] }, receive: { items: [{ id: "777" }] }, proofLimit: 0, ownershipLimit: 1,
  });
  assert.equal(mismatch.give.items[0].copyStatus, "mismatch");
  assert.deepEqual(mismatch.ownership, {});
  assert.equal(mismatch.receive.totalRap, null);
  assert.equal(mismatch.nominalWL.value, null);

  const onlyTradeId = await call("get_trade_context", { tradeId: "123" });
  assert.equal(onlyTradeId.give, null);
  assert.equal(onlyTradeId.receive, null);
  assert.equal(onlyTradeId.nominalWL.value, null);
  assert.equal(urls.some((url) => url.includes("trades.roblox.com")), false);
  for (const args of [{}, { proofLimit: 11 }, { give: { items: [{ id: assetId, quantity: 2, uaid }] } },
    { give: { items: [{ id: assetId, quantity: 4 }, "SKOTN"] } }]) {
    assert.equal((await client.callTool({ name: "get_trade_context", arguments: args })).isError, true);
  }
  const beforeInvalidLookups = urls.length;
  assert.equal((await call("get_trade_proofs", { ...proofArgs, kind: "bundle" })).discord.reason, "no_item_search_terms");
  assert.equal((await call("get_trade_proofs", { query: "missing item" })).status, "not_found");
  for (const args of [{}, { ...proofArgs, query: "SKOTN" }]) {
    assert.equal((await client.callTool({ name: "get_trade_proofs", arguments: args })).isError, true);
  }
  assert.equal(urls.length, beforeInvalidLookups);

  for (const [failure, reason, status] of [
    ["invalid", "invalid_proof_response", 200], ["empty", undefined, undefined],
    ["403", "http_error", 403], ["network", "request_failed", undefined],
    ["timeout", "timeout", undefined], ["429", "rate_limited", 429],
  ]) {
    discordFailure = failure;
    const fallback = await call("get_trade_proofs", proofArgs);
    assert.equal(fallback.instanceId, live.instanceId);
    assert.equal(fallback.evidenceType, "reviewed_screenshot");
    assert.equal(fallback.discord.reason, reason);
    assert.equal(fallback.discord.httpStatus, status);
    assert.equal(JSON.stringify(fallback).includes(proofToken), false);
    assert.equal(fallback.total, 1);
    assert.deepEqual(fallback.records[0].robux, [0, null]);
    assert.equal(fallback.records[0].source, link);
  }
  const requestCount = urls.length;
  const beyond = await call("get_trade_proofs", { ...proofArgs, page: 2, limit: 1 });
  assert.equal(beyond.discord.reason, "rate_limited");
  assert.deepEqual(beyond.records, []);
  assert.equal(urls.length, requestCount);
  const reviewedContext = await call("get_trade_context", {
    give: { items: [{ id: assetId, quantity: 2 }] }, receive: { items: ["Other Limited"] },
  });
  assert.deepEqual(Object.keys(reviewedContext.proofs), [postId]);
  assert.deepEqual(reviewedContext.proofs[postId].reviewed.robux, [0, null]);
  assert.equal(reviewedContext.items["asset:9"].proofs.postIds[0], postId);
  assert.equal(reviewedContext.sources[reviewedContext.items["asset:9"].proofs.discord].httpStatus, 429);
  assert.equal((await client.callTool({ name: "get_item_stats", arguments: { id: "https://example.com" } })).isError, true);
  assert.equal((await originalFetch(endpoint, { method: "POST", headers: { Origin: "https://example.com" } })).status, 403);
});

test("MCP retries an empty legacy face lookup with its mapped bundle name in Discord", async (t) => {
  const legacyId = "2409285794";
  const bundleId = "105919952545574";
  const postId = "1575118416581230723";
  const legacyName = "Legacy Fixture Face";
  const bundleName = "Dynamic Fixture Head";
  const content = `${legacyName} / ${bundleName}`;
  const attachmentId = "1575118416229175408";
  const attachment = `discord-attachment:${postId}:${attachmentId}`;
  const urlForImage = `https://cdn.discordapp.com/attachments/535250426061258753/${attachmentId}/proof.png`;
  const lookups = [];
  let legacyHasProof = false;
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    if (url.hostname === "api.rolimons.com" && url.pathname === "/items/v1/faceassetbundlemap") {
      return Response.json({ face_asset_bundle_map: { [legacyId]: bundleId } });
    }
    assert.equal(url.origin, "https://discord.com");
    const term = url.searchParams.get("content");
    assert.ok([legacyName, bundleName].includes(term));
    lookups.push(term);
    const messages = term === bundleName || legacyHasProof ? [[{ id: postId, content, hit: true,
      channel_id: "535250426061258753", attachments: [{ url: urlForImage }] }]] : [];
    return Response.json({ total_results: messages.length, messages });
  });
  const readAliases = createFaceAliases();
  const readLiveProofs = createDiscordProofClient({ ROXOL_DISCORD_TOKEN: "fixture-token" }, {
    cacheMs: 0,
    readItemFeed: async () => new Map([
      [`asset:${legacyId}`, { name: legacyName }],
      [`bundle:${bundleId}`, { name: bundleName }],
    ]),
  });
  const screenshots = await createScreenshotIndex({ env: {}, readImage: readLiveProofs.readImage, readAliases });
  const server = createRoxolServer({ readAliases, readLiveProofs, screenshots }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const client = new Client({ name: "roxol-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
  t.after(() => client.close());

  for (const [lookup, kind, expectedRequests] of [
    [{ id: legacyId }, "asset", [legacyName, bundleName]],
    [{ query: bundleId }, "bundle", [legacyName, bundleName]],
    [{ id: bundleId }, "bundle", [legacyName, bundleName]],
    [{ id: legacyId, kind: "asset" }, "asset", [legacyName, bundleName]],
    [{ query: legacyId }, "asset", [legacyName]],
  ]) {
    legacyHasProof = expectedRequests.length === 1;
    lookups.length = 0;
    const { structuredContent: result } = await client.callTool({
      name: "get_trade_proofs", arguments: { ...lookup, readScreenshots: false },
    });
    assert.deepEqual(lookups, expectedRequests);
    assert.equal(result.status, "ok");
    assert.deepEqual(result.item, { id: lookup.id ?? lookup.query, kind });
    assert.equal(result.source, "https://discord.com/channels/415246288779608064/535250426061258753");
    const [record] = result.records;
    assert.equal(record.postId, postId);
    assert.equal(record.content, content);
    assert.deepEqual(record.attachments, [attachment]);
    assert.equal(record.screenshots, undefined);
  }
});

test("Discord proof images refresh a signed URL without changing its attachment reference", async () => {
  const channelId = "535250426061258753";
  const postId = "1575118416581230723";
  const attachmentId = "1575118416229175408";
  const imageUrl = `https://cdn.discordapp.com/attachments/${channelId}/${attachmentId}/proof.png`;
  let searches = 0;
  const downloaded = [];
  const request = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === "discord.com") {
      assert.equal(options.headers.Authorization, "fixture-token");
      searches++;
      if (searches === 1) return new Response(null, { status: 500 });
      return Response.json({ total_results: 2, messages: [
        [{ id: postId, channel_id: channelId, content: "Fixture Item / Other",
          attachments: [{ url: `${imageUrl}?sig=${searches}` }] }],
        [{ id: "1575118416581230724", channel_id: channelId, content: "Fixture Items / Other" }],
      ] });
    }
    assert.equal(options.headers, undefined);
    downloaded.push(url.href);
    return url.search === "?sig=2" ? new Response(null, { status: 403 })
      : new Response(Buffer.from("89504e470d0a1a0a", "hex"));
  };
  const readProofs = createDiscordProofClient({ ROXOL_DISCORD_TOKEN: "fixture-token" }, {
    request, readItemFeed: async () => new Map([["asset:1", { name: "Fixture Item" }]]),
  });
  const item = { kind: "asset", id: "1" };
  const result = await readProofs(item);
  assert.equal(result.partial, false);
  assert.equal(result.count, 1);
  const [reference] = result.records[0].attachments;
  assert.equal(reference, `discord-attachment:${postId}:${attachmentId}`);
  assert.equal(await readProofs.readImage(imageUrl), null);
  assert.equal((await readProofs.readImage(reference)).mime, "png");
  assert.deepEqual(downloaded, [`${imageUrl}?sig=2`, `${imageUrl}?sig=3`]);
  assert.equal((await readProofs(item)).records[0].attachments[0], reference);
  assert.equal(searches, 3);
});

test("proof Robux uses separate screenshot item values and leaves unclear fee math unknown", () => {
  const skotn = [[{ quantity: 1, value: 470000 }], [240000, 40000, 150000, 8000]
    .map((value) => ({ quantity: 1, value }))];
  const zero = { amount: 0, basis: "unknown" };
  const proof = proofRobux(skotn, [zero, { amount: 35000, basis: "after_fee" }]);
  assert.deepEqual(proof.robux[1], {
    amount: 35000, basis: "after_fee", offered: 50000, credited: 35000, offeredInferred: true,
  });
  assert.deepEqual(proof.netValue, [3000, -18000]);
  assert.deepEqual(proof.netRap, [null, null]);
  assert.deepEqual(proof.netDisplayedPrice, [null, null]);
  assert.deepEqual(proofRobux(skotn, [zero, { amount: 50000, basis: "offered" }]).netValue, proof.netValue);

  const baskets = [[{ quantity: 1, rap: 100 }], [{ quantity: 1, rap: 200 }]];
  const result = proofRobux(baskets, [zero, { amount: 1, basis: "after_fee" }]);
  assert.deepEqual(result.netRobux, [1, null]);
  assert.deepEqual(result.netRap, [101, null]);
  assert.deepEqual(result.netValue, [null, null]);
  assert.equal(result.creditedDifference, 1);
  const unknown = proofRobux(baskets, [{ amount: null, basis: "unknown" }, { amount: 10, basis: "unknown" }]);
  assert.deepEqual(unknown.netRobux, [null, null]);
  assert.equal(unknown.creditedDifference, null);
  const combinedOnly = proofRobux([[{ quantity: 1 }], [{ quantity: 1 }]],
    [zero, { amount: null, basis: "unknown" }], [{ value: 470000 }, { value: null }]);
  assert.deepEqual(combinedOnly.netValue, [null, null]);
});

test("Nevos proof requests use configured URL and header overrides", async (t) => {
  const readLiveProofs = createNevosProofClient({
    ROXOL_PROOFS_URL: "https://proofs.example/search/",
    ROXOL_PROOFS_ACCEPT: "application/*",
    ROXOL_PROOFS_CONTENT_TYPE: "application/json; charset=UTF-8",
    ROXOL_PROOFS_FROM_EXTENSION: "fixture-extension",
    ROXOL_PROOFS_TOKEN: "fixture-token",
    ROXOL_PROOFS_ORIGIN: "https://extension.example",
    ROXOL_PROOFS_USER_AGENT: "fixture-agent",
    ROXOL_PROOFS_SEC_FETCH_DEST: "document",
    ROXOL_PROOFS_SEC_FETCH_MODE: "same-origin",
    ROXOL_PROOFS_SEC_FETCH_SITE: "same-site",
  });
  const fetch = t.mock.method(globalThis, "fetch", () => Response.json({ results: [] }));
  const result = await readLiveProofs({ id: "439945661", kind: "asset" });
  assert.equal(result.reason, "empty_proof_response");
  assert.equal(fetch.mock.callCount(), 1);
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(url, "https://proofs.example/search/439945661");
  assert.equal(init.mode, "same-origin");
  assert.deepEqual(init.headers, {
    Accept: "application/*",
    "Content-Type": "application/json; charset=UTF-8",
    "From-Extension": "fixture-extension",
    "X-Nte-Client": "fixture-token",
    Origin: "https://extension.example",
    "User-Agent": "fixture-agent",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "same-origin",
    "Sec-Fetch-Site": "same-site",
  });
});

test("Missing Discord credentials skip live requests and preserve the reviewed fallback", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected upstream request");
  });
  const item = { id: "439945661", kind: "asset" };
  const record = { postId: "1450000000000000000", baskets: [[item], []] };
  const reviewed = { loadedAt: Date.now(), records: [record], byItem: new Map([["asset:439945661", [record]]]) };
  const result = await tradeProofs(reviewed, item, { page: 1, limit: 20 }, createDiscordProofClient({}));
  assert.equal(result.evidenceType, "reviewed_screenshot");
  assert.equal(result.discord.reason, "no_discord_token");
  assert.deepEqual(result.records, [{ ...record, discordUrl: `${result.proofOrigin.url}/${record.postId}` }]);
  assert.equal(fetch.mock.callCount(), 0);
});
