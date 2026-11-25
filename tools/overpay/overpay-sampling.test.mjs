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

async function sample(rows, {
  previous = [], unavailablePage, unavailableProfile, asOf = now, readStoredProfile, profileFailure,
} = {}) {
  const pages = [];
  const profiles = [];
  const progress = [];
  const result = await Sampling.sampleItem({
    assetId: "101", previous, now: asOf, clock: () => asOf, readStoredProfile,
    onProgress: ({ groups }) => progress.push(Object.fromEntries(Object.entries(groups)
      .map(([group, { summary }]) => [group, summary.valuationCoverage]))),
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
      const failure = profileFailure?.(id);
      if (failure) return failure;
      const value = { 101: 100, 102: 110, 103: 55, 104: 130 }[id];
      return value && id !== unavailableProfile ? { profile: { checkedAt: asOf, rap: [], history: {
        changes: [{ time: now - 100 * day, after: value }],
      } } } : { profile: null, failure: { reason: "profile-http-error", httpStatus: 429 }, retryAt: asOf + 60_000 };
    },
  });
  return { ...result, pages, profiles, progress };
}

test("sample size is independent of pricing and tracks exclusions and unpriced trades", async () => {
  const rows = Array.from({ length: 600 }, (_, index) => record(index + 1));
  rows[1] = { ...rows[0] };
  rows[3] = record(4, { other: "999" });
  const result = await sample(rows);
  assert.equal(result.reason, "cap");
  assert.deepEqual(result.pages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(result.groups.swap.summary.sampleSize, 248);
  assert.equal(result.groups.swap.history.length, 249);
  assert.equal(result.groups.downgrade.summary.sampleSize, 250);
  assert.equal(result.groups.swap.summary.overpay.median, 10);
  assert.equal(result.groups.swap.summary.overpayPercent.median, 10);
  assert.equal(result.groups.swap.summary.overpay.iqr, 0);
  assert.equal(result.groups.swap.history[0].observedAt, rows[3].firstObservedAt);
  assert.equal(result.pricingIncomplete, true);
  assert.deepEqual(result.groups.swap.summary.unpricedReasons, { "profile-http-error": 1 });
  assert.deepEqual(result.groups.swap.history[0].pricingFailures,
    [{ assetId: "999", reason: "profile-http-error", httpStatus: 429, pending: true }]);
  assert.equal(result.pricingRetryAt, now + 60_000);
  assert.deepEqual(result.exclusions, { "duplicate-trade": 1 });
  assert.equal(result.audit.length, 500);
});

test("low demand stops at the 30-day boundary and rare history stops at the end of the feed", async () => {
  const rows = Array.from({ length: 60 }, (_, index) => record(index + 1, { group: 0 }));
  rows[55] = record(56, { at: now - 30 * day, group: 0, other: "999" });
  const low = await sample(rows);
  assert.deepEqual(low.pages, [1, 2]);
  assert.equal(low.reason, "date");
  assert.equal(low.groups.swap.summary.sampleSize, 55);
  assert.equal(low.audit.length, 60);
  assert.deepEqual(low.exclusions, { "outside-window": 5 });
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
  assert.deepEqual(first.groups.swap.summary.unpricedReasons,
    { "profile-http-error": 1, "deferred-profile-lookup": 1 });

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
  assert.equal(warm.groups.swap.summary.sampleSize, 121);
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

test("profile priority spans pages and progress preserves the sample while a 429 defers work", async () => {
  const rows = [
    ...Array.from({ length: 50 }, (_, index) => record(index + 1, { group: 0, other: "104" })),
    ...Array.from({ length: 60 }, (_, index) => record(index + 51, { group: 0, other: "102" })),
    record(111, { group: 1, other: "102" }),
  ];
  const saved = await sample(rows, {
    profileFailure: (id) => id === "104" ? {
      profile: null, failure: { reason: "profile-http-error", httpStatus: 429 }, retryAt: now + 8000,
    } : null,
  });
  assert.deepEqual(saved.profiles, ["101", "102", "104"]);
  assert.equal(saved.progress[0].swap.pendingTrades, 110);
  assert.equal(saved.progress[0].downgrade.pendingTrades, 1);
  assert.equal(saved.progress[2].swap.pricedTrades, 60);
  assert.equal(saved.progress[2].downgrade.pricedTrades, 1);
  assert.equal(saved.pricingRetryAt, now + 8000);
  assert.equal(saved.retryReason, "deferred-provider-cooldown");
  assert.equal(saved.groups.swap.summary.valuationCoverage.pendingTrades, 50);
  const resumed = await sample(rows, { previous: saved.records, asOf: now + 8000 });
  assert.equal(resumed.groups.swap.summary.sampleSize, 110);
  assert.equal(resumed.groups.swap.summary.valuationCoverage.pendingTrades, 0);
  assert.equal(resumed.pricingRetryAt, null);
});

test("dated profile gaps are unavailable and never substituted with current prices", async () => {
  const rows = [record(1, { group: 0 })];
  const result = await sample(rows, {
    readStoredProfile: async (id) => id === "102" && {
      profile: { checkedAt: now, currentValue: 110, rap: [], history: {
        changes: [{ time: now, after: 110 }],
      } },
    },
  });
  assert.deepEqual(result.profiles, []);
  const { valuationCoverage } = result.groups.swap.summary;
  assert.equal(valuationCoverage.pricedTrades, 0);
  assert.equal(valuationCoverage.pendingTrades, 0);
  assert.equal(valuationCoverage.unavailableTrades, 1);
  assert.equal(result.pricingRetryAt, null);
});
