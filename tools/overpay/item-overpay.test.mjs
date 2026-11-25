import assert from "node:assert/strict";
import { test } from "node:test";
import { itemOverpay } from "./item-overpay.mjs";
import { validateTrades } from "./trade-validation.mjs";
import { normalizeTrades } from "./trade-valuations.mjs";

const now = Date.parse("2026-11-25T12:00:00Z");
const recent = "2026-11-24T12:00:00Z";
const item = (assetId, value, options = {}) => ({
  assetId, quantity: 1, historical: value === null ? null : { value, method: "assigned-value" }, ...options,
});
function trade(tradeId, sideA, sideB, options = {}) {
  const total = (side) => side.every(({ historical, quantity }) => historical && quantity)
    ? side.reduce((sum, row) => sum + row.historical.value * row.quantity, 0) : null;
  return {
    tradeId, sideA, sideB, valuationAt: recent, firstObservedAt: recent, lastObservedAt: recent, inferred: true,
    historicalItemOnlyOverpay: { sideATotal: total(sideA), sideBTotal: total(sideB) }, ...options,
  };
}

test("historical swap distribution uses per-trade percentages and reports coverage and recency", () => {
  const trades = [
    trade("1", [item("101", 100)], [item("102", 90)]),
    trade("2", [item("102", 100)], [item("101", 100)], { robux: { sideA: 0, sideB: 0 } }),
    trade("3", [item("101", 200)], [item("102", 220, { historical: { value: 220, method: "rap-snapshot" } })]),
    trade("4", [item("101", 400)], [item("102", 900)], { robux: { sideA: 20, sideB: null } }),
    trade("5", [item("101", 100)], [item("102", null)]),
    trade("6", [item("101", 100)], [item("102", 0)]),
    trade("7", [item("101", 100)], [item("102", 110)], { valuationAt: "2026-09-01T12:00:00Z" }),
    trade("8", [item("101", 100)], [item("102", 110)], { valuationAt: "2026-11-25T13:00:00Z" }),
  ];
  const result = itemOverpay([...trades, trades[0]], now).items["101"];
  const { recent: stats, allObserved } = result.groups.swap;
  assert.equal(result.observedTrades, 8);
  assert.equal(result.exclusions["invalid-observation-time"], 1);
  assert.deepEqual(stats.overpay, { median: 10, quartiles: [-2.5, 140], iqr: 142.5 });
  assert.deepEqual(stats.overpayPercent, { median: 5, quartiles: [-2.5, 38.75], iqr: 41.25 });
  assert.deepEqual(stats.valuationCoverage, {
    eligibleTrades: 6, pricedTrades: 4, fractionPriced: 4 / 6, assignedValueOnly: 3, usesRap: 1,
  });
  assert.deepEqual(stats.robuxCoverage, { unknown: 2, "reported-zero": 1, "reported-nonzero": 1 });
  assert.equal(stats.severeImbalances, 1);
  assert.equal(stats.withinTwofoldValue.medianOverpay, 0);
  assert.equal(stats.marketRate.overpay.median, 0);
  assert.equal(stats.marketRate.confidence, "insufficient");
  assert.equal(stats.recency.daysSinceLastPriced, 1);
  assert.equal(stats.thinSample, true);
  assert.equal(allObserved.sampleSize, 5);
});

test("standard confidence requires sample size, pricing coverage and a low severe-imbalance rate", () => {
  const balanced = Array.from({ length: 30 }, (_, i) => trade(String(i), [item("101", 100)], [item("102", 200)]));
  const missing = Array.from({ length: 8 }, (_, i) => trade("missing-" + i, [item("101", 100)], [item("102", null)]));
  const severe = Array.from({ length: 4 }, (_, i) => trade("severe-" + i, [item("101", 100)], [item("102", 201)]));
  const stats = (rows) => itemOverpay(rows, now).items["101"].groups.swap.recent;
  assert.equal(stats(balanced).confidence, "standard");
  assert.deepEqual(stats([...balanced, ...missing]).marketRate.confidenceReasons, ["pricing-coverage-below-80-percent"]);
  const quality = stats([...balanced, ...severe]);
  assert.equal(quality.confidence, "low");
  assert.equal(quality.severeImbalances, 4);
  assert.equal(quality.marketRate.sampleSize, 30);
  assert.deepEqual(quality.marketRate.confidenceReasons, ["more-than-10-percent-severely-imbalanced"]);
});

test("one-for-many preserves copy count and shows both perspectives; bundled targets lack attributed OP", () => {
  const results = itemOverpay([
    trade("1", [item("201", 200)], [item("203", 110, { quantity: 2 })]),
    trade("2", [item("201", 200), item("203", 100)], [item("204", 300), item("205", 10)]),
    trade("3", [item("201", 200)], [item("201", 200)]),
    trade("4", [item("201", 200, { userAssetId: "42" })], [item("203", 200, { userAssetId: 42 })]),
    trade("5", [item("201", 200)], [item("203", 200, { quantity: null })]),
    trade("6", [item("201", 200)], [item("203", 50, { quantity: 5 })]),
  ], now).items;
  assert.deepEqual(results["201"].exclusions, {
    "many-for-many": 1, "same-asset-on-both-sides": 1, "duplicate-copy-id": 1, "invalid-basket": 2,
  });
  const { upgrade, downgrade, swap } = results["201"].groups;
  assert.equal(upgrade.recent.overpay.median, -20);
  assert.equal(upgrade.recent.overpayPercent.median, -10);
  assert.equal(downgrade.recent.overpay.median, 20);
  assert.equal(downgrade.recent.overpayPercent.median, 10);
  assert.equal(swap.recent.overpay.median, null);
  assert.equal(results["203"].exclusions["target-bundled"], 1);
});

const proofItem = (id, options = {}) => ({ kind: "asset", id, quantity: 1, ...options });
const proof = (id, baskets, options = {}) => ({ id, baskets, date: "2026-11-24", robux: [206, 0], ...options });

test("completed-proof validation handles reversed baskets, quantities, copy conflicts and ambiguous repeats", () => {
  const rows = [
    trade("a", [item("102", 5, { quantity: 2 })], [item("101", 10, { serial: 5 })]),
    trade("b", [item("101", 10, { serial: "6" })], [item("102", 5), item("102", 5)]),
    trade("c", [item("201", 50)], [item("202", 51)], { inferred: false }),
    trade("d", [item("201", 50)], [item("202", 51)], { inferred: false }),
    trade("e", [item("301", 50)], [item("302", 51)], { inferred: null, firstObservedAt: "2026-11-20T20:00:00Z",
      lastObservedAt: "2026-11-20T21:00:00Z" }),
  ];
  const repeated = [proofItem("102"), proofItem("102")];
  const report = validateTrades(rows, { pricedTrades: [
    proof("A", [[proofItem("101", { serial: "5" })], repeated]),
    proof("B", [[proofItem("101", { serial: "7" })], repeated]),
    proof("C", [[proofItem("201")], [proofItem("202")]]),
    proof("D", [[proofItem("301")], [proofItem("302")]]),
    proof("E", [[proofItem("101", { quantity: 2 })], repeated]),
  ] });
  assert.deepEqual(report.summary.proofOutcomes, {
    "copy-corroborated": 1, "copy-conflict": 1, ambiguous: 1, "not-found": 2,
  });
  assert.equal(report.summary.byProviderFlag.true.copyCorroborated, 1);
  assert.equal(report.matched.get("a").reversed, true);
  assert.deepEqual(report.matched.get("a").robux, { sideA: 0, sideB: 206, basis: null });
});

test("validation never reuses one candidate to corroborate multiple proofs", () => {
  const t = trade("a", [item("101", 50)], [item("102", 51)]);
  const sides = [[proofItem("101")], [proofItem("102")]];
  const report = validateTrades([t], { pricedTrades: [proof("a", sides), proof("b", sides)] });
  assert.deepEqual(report.summary.proofOutcomes, { ambiguous: 2 });
  assert.equal(report.matched.size, 0);
});

test("raw provider flag never establishes completed status or Robux", () => {
  const trades = normalizeTrades({ trades: [{
    trade_id: "a", inferred: false, ts: Date.parse(recent) / 1000,
    side_a_items: [{ asset_id: 101 }], side_b_items: [{ asset_id: 102 }],
  }] });
  const report = validateTrades(trades, { pricedTrades: [
    proof("a", [[proofItem("101")], [proofItem("102")]], { robux: null }),
  ] });
  assert.equal(report.matched.get("a").status, "basket-match");
  assert.equal(report.matched.get("a").robux.sideA, null);
});

test("normalization retains duplicate and malformed inputs in the audit", () => {
  const original = { trade_id: "a", side_a_items: [{ asset_id: 101 }], side_b_items: [{ asset_id: 102 }] };
  const replacement = { ...original, inferred: true };
  const missing = { trade_id: "b", side_a_items: [] };
  const excluded = [];
  const trades = normalizeTrades({ trades: [original, replacement, missing, null] }, excluded);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].inferred, true);
  assert.deepEqual(excluded, [
    { index: 0, reason: "duplicate-trade", record: original },
    { index: 2, reason: "missing-basket", record: missing },
    { index: 3, reason: "invalid-source-record", record: null },
  ]);
});
