import assert from "node:assert/strict";
import { test } from "node:test";
import ItemOverpay from "../../extension/shared/item-overpay.js";
import TradeValuations from "../../extension/shared/trade-valuations.js";
import Sampling from "../../extension/shared/overpay-sampling.js";

Object.assign(globalThis, { RoxolItemOverpay: ItemOverpay, RoxolTradeValuations: TradeValuations });
const now = Date.parse("2026-11-25T12:00Z");
const day = 86_400_000;
const item = (assetId, quantity = 1) => ({ assetId, quantity });

function record(index, { at = now - index * 60_000, group = index % 2, other = group ? "103" : "102" } = {}) {
  const id = String(index);
  const firstObservedAt = new Date(at).toISOString();
  return { id, firstObservedAt, trade: {
    tradeId: id, firstObservedAt, lastObservedAt: firstObservedAt,
    sideA: [item("101")], sideB: [item(other, group ? 2 : 1)],
  } };
}

async function sample(rows, { previous = [], unavailablePage, unavailableProfile, asOf = now } = {}) {
  const pages = [];
  const profiles = [];
  const result = await Sampling.sampleItem({
    assetId: "101", previous, now: asOf,
    async readPage(page, limit) {
      pages.push(page);
      assert.equal(limit, 50);
      return page === unavailablePage ? { status: "unavailable" } : {
        status: "ok", pages: Math.ceil(rows.length / limit) || 1, total: rows.length,
        records: rows.slice((page - 1) * limit, page * limit),
      };
    },
    async readTradeProfile(id) {
      profiles.push(id);
      const value = { 101: 100, 102: 110, 103: 55, 104: 130 }[id];
      return value && id !== unavailableProfile ? { checkedAt: asOf, rap: [], history: {
        changes: [{ time: now - 100 * day, after: value }],
      } } : null;
    },
  });
  return { ...result, pages, profiles };
}

test("high demand stops when both categories have 100 priced trades, excluding duplicates and unpriced trades", async () => {
  const rows = Array.from({ length: 600 }, (_, index) => record(index + 1));
  rows[1] = { ...rows[0] };
  rows[3] = record(4, { other: "999" });
  const result = await sample(rows);
  assert.equal(result.reason, "target");
  assert.deepEqual(result.pages, [1, 2, 3, 4, 5]);
  assert.equal(result.groups.swap.summary.sampleSize, 123);
  assert.equal(result.groups.swap.history.length, 124);
  assert.equal(result.groups.downgrade.summary.sampleSize, 125);
  assert.equal(result.groups.swap.summary.overpay.median, 10);
  assert.equal(result.groups.swap.summary.overpayPercent.median, 10);
  assert.equal(result.groups.swap.summary.overpay.iqr, 0);
  assert.equal(result.groups.swap.history[0].observedAt, rows[3].firstObservedAt);
  assert.equal(result.pricingIncomplete, true);
});

test("low demand stops at the 30-day boundary and rare history stops at the end of the feed", async () => {
  const rows = Array.from({ length: 60 }, (_, index) => record(index + 1, { group: 0 }));
  rows[55] = record(56, { at: now - 30 * day, group: 0, other: "999" });
  const low = await sample(rows);
  assert.deepEqual(low.pages, [1, 2]);
  assert.equal(low.reason, "date");
  assert.equal(low.groups.swap.summary.sampleSize, 55);
  assert.ok(!low.profiles.includes("999"));
  for (const [count, confidence] of [[0, "insufficient"], [9, "insufficient"], [10, "low"], [29, "low"], [30, "standard"]]) {
    const result = await sample(rows.slice(0, count));
    assert.equal(result.reason, "end");
    assert.equal(result.groups.swap.summary.sampleSize, count);
    assert.equal(result.groups.swap.summary.confidence, confidence);
  }
});

test("raw cap counts ineligible records and stops after ten requests", async () => {
  const rows = Array.from({ length: 550 }, (_, index) => ({ ...record(index + 1), trade: null }));
  const result = await sample(rows);
  assert.equal(result.reason, "cap");
  assert.equal(result.records.length, 500);
  assert.equal(result.pages.length, 10);
  assert.equal(result.profiles.length, 0);
});

test("unavailable focal pricing skips counterpart lookups and can recover on refresh", async () => {
  const rows = [record(1), record(2)];
  const first = await sample(rows, { unavailableProfile: "101" });
  assert.deepEqual(first.profiles, ["101"]);
  assert.equal(first.pricingIncomplete, true);
  assert.equal(first.groups.swap.summary.sampleSize, 0);
  assert.equal(first.groups.swap.history.length, 1);

  const again = await sample(rows, { previous: first.records, asOf: now + 120_000 });
  assert.equal(again.pricingIncomplete, false);
  assert.equal(again.groups.swap.summary.sampleSize, 1);
});

test("refresh uses cached history and prices only new or changed records", async () => {
  const rows = Array.from({ length: 240 }, (_, index) => record(index + 1));
  const cold = await sample(rows);
  const newTrade = record(0, { other: "104" });
  const changed = record(2, { other: "104" });
  const warm = await sample([newTrade, rows[0], changed, ...rows.slice(2)], { previous: cold.records });
  assert.deepEqual(warm.pages, [1]);
  assert.deepEqual(warm.profiles, ["101", "104"]);
  assert.equal(warm.groups.swap.summary.sampleSize, 100);
  assert.deepEqual(warm.groups.swap.history.slice(0, 2).map(({ overpay }) => overpay), [30, 30]);
});

test("refresh resumes beyond a cached tail and discards aged-out records", async () => {
  const rows = Array.from({ length: 70 }, (_, index) => record(index + 1));
  const partial = await sample(rows, { unavailablePage: 2 });
  assert.equal(partial.partial, true);
  assert.equal(partial.groups.swap.summary.sampleSize, 25);
  const cold = await sample(rows);
  const extra = Array.from({ length: 50 }, (_, index) => record(index + 71));
  const warm = await sample([...rows, ...extra], { previous: cold.records });
  assert.deepEqual(warm.pages, [1, 2, 3]);
  assert.equal(warm.groups.swap.summary.sampleSize, 60);
  const offline = await sample(rows, { previous: cold.records, unavailablePage: 1, asOf: now + 30 * day });
  assert.equal(offline.partial, true);
  assert.equal(offline.groups.swap.summary.sampleSize, 0);
});
