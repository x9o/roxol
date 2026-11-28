import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ItemOverpay from "../../extension/shared/item-overpay.js";
import TradeValuations from "../../extension/shared/trade-valuations.js";
import Sampling from "../../extension/shared/overpay-sampling.js";

Object.assign(globalThis, { RoxolItemOverpay: ItemOverpay, RoxolTradeValuations: TradeValuations });
const now = Date.parse("2026-11-25T12:00Z");
const day = 86_400_000;
const item = (assetId, valueThen, rap, quantity = 1) => ({ assetId, quantity, valueThen, rap });
const feed = new Map([
  ["asset:101", { value: 100, rap: 50, checkedAt: now }],
  ["asset:102", { value: 110, rap: 30, checkedAt: now }],
  ["asset:103", { value: 0, rap: 60, checkedAt: now }],
  ["asset:105", { value: 350, rap: 10, checkedAt: now }],
]);

function record(index, { at = now - index * 60_000, sideB = [item("102", 115, 20)] } = {}) {
  const id = String(index);
  const firstObservedAt = new Date(at).toISOString();
  return { id, firstObservedAt, trade: {
    tradeId: id, firstObservedAt, lastObservedAt: firstObservedAt,
    sideA: [item("101", 90, 25)], sideB,
  } };
}

async function sample(rows, { previous, unavailablePage, asOf = now } = {}) {
  const pages = [];
  const result = await Sampling.sampleItem({
    assetId: "101", previous, now: asOf, feed,
    async readPage(page, limit) {
      pages.push(page);
      assert.equal(limit, 50);
      return page === unavailablePage ? { status: "unavailable", httpStatus: 503 } : {
        status: "ok", pages: Math.ceil(rows.length / limit) || 1, total: rows.length,
        records: rows.slice((page - 1) * limit, page * limit),
      };
    },
  });
  return { ...result, pages };
}

test("current Rolimon’s prices replace both sides, use RAP as fallback and require prices for every copy", async () => {
  const rows = [
    record(1),
    record(2, { sideB: [item("103", 40, 35, 2)] }),
    record(3, { sideB: [item("104", 115, 90)] }),
    record(4, { sideB: [item("105", 100, 10)] }),
  ];
  rows[0].sample = { overpay: 999 };
  const { groups, audit, pricingSource, pricedAt } = await sample(rows);
  assert.equal(pricingSource, "rolimons-itemdetails");
  assert.equal(pricedAt, now);
  assert.equal(groups.swap.summary.marketRate.overpay.median, 10);
  assert.equal(groups.swap.summary.marketRate.overpayPercent.median, 10);
  assert.equal(groups.swap.summary.severeImbalances, 1);
  assert.deepEqual(groups.swap.summary.valuationCoverage, {
    eligibleTrades: 3, pricedTrades: 2, fractionPriced: 2 / 3, assignedValueOnly: 2, usesRap: 0,
  });
  assert.equal(groups.downgrade.summary.overpay.median, 20);
  assert.equal(groups.downgrade.summary.overpayPercent.median, 20);
  assert.equal(groups.downgrade.summary.valuationCoverage.usesRap, 1);
  assert.deepEqual(audit[2].sample.pricingFailures, [{ assetId: "104", reason: "missing-current-rolimons-price" }]);
  assert.equal(audit[0].trade.sideA[0].valueThen, 90);
});

test("stops at seven days, the end of history, or 500 raw records", async () => {
  const rows = Array.from({ length: 60 }, (_, index) => record(index + 1));
  for (let index = 55; index < rows.length; index++) rows[index] = record(index + 1, { at: now - 7 * day });
  rows[1] = rows[0];
  const recent = await sample(rows);
  assert.deepEqual(recent.pages, [1, 2]);
  assert.equal(recent.reason, "date");
  assert.equal(recent.groups.swap.summary.sampleSize, 54);
  assert.deepEqual(recent.exclusions, { "duplicate-trade": 1, "outside-window": 5 });
  assert.equal((await sample(rows.slice(0, 40))).reason, "end");

  const invalid = Array.from({ length: 550 }, (_, index) => ({ ...record(index + 1), trade: null }));
  const capped = await sample(invalid);
  assert.equal(capped.reason, "cap");
  assert.equal(capped.pages.length, 10);
  assert.equal(capped.audit.length, 500);
  assert.deepEqual(capped.exclusions, { "invalid-source-record": 500 });
});

test("partial pages do not replace a complete cache and cached rows still age out", async () => {
  const rows = Array.from({ length: 70 }, (_, index) => record(index + 1));
  const full = await sample(rows);
  const partial = await sample(rows, { previous: full.saved, unavailablePage: 2 });
  assert.equal(partial.partial, true);
  assert.equal(partial.groups.swap.summary.sampleSize, 50);
  assert.equal(partial.saved, undefined);

  const previous = { records: [record(1), record(2, { at: now - 7 * day + 1000 })] };
  previous.records[0].sample = { overpay: 999 };
  const fallback = await sample(rows, { previous, asOf: now + 1000, unavailablePage: 1 });
  assert.equal(fallback.cachedFallback, true);
  assert.equal(fallback.groups.swap.summary.sampleSize, 1);
  assert.equal(fallback.groups.swap.summary.overpay.median, 10);
  assert.equal(fallback.exclusions["outside-window"], 1);
  assert.equal(fallback.historyFailure.httpStatus, 503);
  assert.equal((await sample(rows, { unavailablePage: 1 })).status, "unavailable");
});

test("Marketplace fetches overpay directly from Nevos and preserves RoUtility trade history", async () => {
  const scripts = await Promise.all([
    "shared/market_targets.js", "shared/trade-valuations.js", "shared/item-overpay.js", "shared/proof-overpay.js",
    "vendor/nevos/nte_sales_core.js", "vendor/nevos/rolimons_item_details.js", "background/rolimons.js",
    "background/public-market.js", "background/market.js",
  ].map((file) => readFile(new URL(`../../extension/${file}`, import.meta.url), "utf8")));
  const saved = { nevosProofToken: "fixture-token" };
  const urls = [];
  let currentTime = now;
  const priceUrl = "https://api.rolimons.com/items/v3/itemdetails";
  const historyUrl = "https://routility.io/web/item-trades/101?kind=trade&range=all&limit=20&page=1";
  const proofUrl = "https://nevos-extension.com/api/proofs/search/101";
  class WorkerDate extends Date {
    static now() { return currentTime; }
  }

  function startWorker() {
    let listener;
    runInNewContext(scripts.join("\n"), {
      Date: WorkerDate, AbortSignal, URL,
      chrome: {
        runtime: { id: "roxol", onMessage: { addListener: (handler) => { listener = handler; } } },
        storage: { local: { get: async (key) => ({ [key]: saved[key] }) }, onChanged: { addListener() {} } },
      },
      fetch: async (url, init) => {
        urls.push(url);
        if (url === proofUrl) {
          assert.equal(init.method, "POST");
          assert.equal(init.headers["X-NTE-Client"], "fixture-token");
          assert.equal(init.credentials, "omit");
          return Response.json({ item_id: 101, item_name: "Page item", count: 1, results: [{
            id: "1500000000000000000", content: "Page item / 2x Small item\n1000 vs 1012",
          }] });
        }
        if (url === priceUrl) return Response.json({ success: true, items: {
          101: ["Page item", "", 60, 100, 100], 102: ["Other item", "", 110, -1, 110],
          103: ["Small item", "", 55, -1, 55],
        } });
        assert.equal(url, historyUrl);
        const observation = (now - 60_000) / 1000;
        return Response.json({ page: 1, pages: 1, total: 1, per_page: 20, trades: [{
          kind: "trade", trade_id: "trade-1", ts: observation, ts_latest: observation,
          side_a_items: [{ asset_id: 101, value_then: 90, rap: 50 }],
          side_b_items: [{ asset_id: 102, value_then: null, rap: 80 }],
        }] });
      },
    });
    return (type = "overpay", message) => new Promise((resolve) => {
      assert.equal(listener({ type: `roxol:market-${type}`, assetId: "101", ...message },
        { id: "roxol", frameId: 0, url: "https://www.roblox.com/catalog/101/Item" }, resolve), true);
    });
  }

  const read = startWorker();
  const [first, second, history] = await Promise.all([read(), read(), read("trade-history", { page: 1 })]);
  assert.deepEqual([first.median, second.median], [12, 12]);
  assert.equal(history.prices[101].value, 100);
  assert.equal(history.prices[102].value, 110);
  assert.equal(history.trades[0].sideA[0].valueThen, 90);
  assert.deepEqual(urls.toSorted(), [priceUrl, historyUrl, proofUrl].toSorted());
  currentTime += 119_999;
  assert.equal((await read()).median, 12);
  assert.equal(urls.length, 3);
  currentTime++;
  assert.equal((await read()).median, 12);
  assert.equal(urls.at(-1), proofUrl);
  delete saved.nevosProofToken;
  assert.equal((await startWorker()()).reason, "token-required");
  assert.equal(urls.length, 4);
});
