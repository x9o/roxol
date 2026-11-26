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

function record(index, { at = now - index * 60_000, sideB = [item("102", 110, 20)] } = {}) {
  const id = String(index);
  const firstObservedAt = new Date(at).toISOString();
  return { id, firstObservedAt, trade: {
    tradeId: id, firstObservedAt, lastObservedAt: firstObservedAt,
    sideA: [item("101", 100, 25)], sideB,
  } };
}

async function sample(rows, { previous, unavailablePage, asOf = now } = {}) {
  const pages = [];
  const result = await Sampling.sampleItem({
    assetId: "101", previous, now: asOf,
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

test("snapshot pricing prefers positive Value, falls back to RAP, counts copies and requires both baskets", async () => {
  const rows = [
    record(1),
    record(2, { sideB: [item("103", 0, 60, 2)] }),
    record(3, { sideB: [item("104", null, 0)] }),
    record(4, { sideB: [item("105", 350, 10)] }),
  ];
  rows[0].sample = { overpay: 999 };
  const { groups, audit, pricingSource } = await sample(rows);
  assert.equal(pricingSource, "routility-snapshots");
  assert.equal(groups.swap.summary.marketRate.overpay.median, 10);
  assert.equal(groups.swap.summary.marketRate.overpayPercent.median, 10);
  assert.equal(groups.swap.summary.severeImbalances, 1);
  assert.deepEqual(groups.swap.summary.valuationCoverage, {
    eligibleTrades: 3, pricedTrades: 2, fractionPriced: 2 / 3, assignedValueOnly: 2, usesRap: 0,
  });
  assert.equal(groups.downgrade.summary.overpay.median, 20);
  assert.equal(groups.downgrade.summary.overpayPercent.median, 20);
  assert.equal(groups.downgrade.summary.valuationCoverage.usesRap, 1);
  assert.deepEqual(audit[2].sample.pricingFailures, [{ assetId: "104", reason: "missing-reported-price" }]);
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

test("Marketplace deduplicates requests, reuses saved samples after a worker restart and refreshes after two minutes", async () => {
  const scripts = await Promise.all([
    "shared/market_targets.js", "shared/trade-valuations.js", "shared/item-overpay.js", "shared/overpay-sampling.js",
    "background/market.js",
  ].map((file) => readFile(new URL(`../../extension/${file}`, import.meta.url), "utf8")));
  const saved = {};
  const urls = [];
  let currentTime = now;
  class WorkerDate extends Date {
    static now() { return currentTime; }
  }

  function startWorker() {
    let listener;
    runInNewContext(scripts.join("\n"), {
      Date: WorkerDate, AbortSignal, URL,
      chrome: {
        runtime: { id: "roxol", onMessage: { addListener: (handler) => { listener = handler; } } },
        storage: { local: {
          get: async (key) => ({ [key]: structuredClone(saved[key]) }),
          set: async (entries) => Object.assign(saved, structuredClone(entries)),
        } },
      },
      fetch: async (url) => {
        urls.push(url);
        const observation = (now - 60_000) / 1000;
        return Response.json({ page: 1, pages: 1, total: 1, per_page: 50, trades: [{
          kind: "trade", trade_id: "trade-1", ts: observation, ts_latest: observation,
          side_a_items: [{ asset_id: 101, value_then: 100, rap: 50 }],
          side_b_items: [{ asset_id: 102, value_then: null, rap: urls.length === 1 ? 110 : 120 }],
        }] });
      },
    });
    return () => new Promise((resolve) => {
      assert.equal(listener({ type: "roxol:market-overpay", assetId: "101" },
        { id: "roxol", frameId: 0, url: "https://www.roblox.com/catalog/101/Item" }, resolve), true);
    });
  }

  const read = startWorker();
  const first = await Promise.all([read(), read()]);
  const median = (result) => result.groups.swap.summary.overpay.median;
  assert.deepEqual(first.map(median), [10, 10]);
  assert.equal(urls.length, 1);
  currentTime += 119_999;
  const restarted = startWorker();
  assert.equal(median(await restarted()), 10);
  assert.equal(urls.length, 1);
  currentTime++;
  assert.equal(median(await restarted()), 20);
  assert.deepEqual(urls, Array(2).fill("https://routility.io/web/item-trades/101?kind=trade&range=all&limit=50&page=1"));
});
