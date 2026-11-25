import assert from "node:assert/strict";
import test from "node:test";
import { coverage, normalizeTrades, parseItemProfile, resolveTrades } from "./trade-valuations.mjs";

const midnight = Date.parse("2026-11-25T00:00:00Z") / 1000;
const observedAt = midnight + 3600;
const checkedAt = (midnight + 7200) * 1000;

function profile(id, value, changes = [], seconds = midnight, rap = 600) {
  const source = `https://www.rolimons.com/item/${id}`;
  const details = { item_id: id, description: "Hello; world", first_timestamp: midnight - 86400, value, rap: 900 };
  const chart = { num_points: 1, timestamp: [seconds], rap: [rap] };
  return parseItemProfile(`var item_details_data = ${JSON.stringify(details)};\n` +
    `var history_data = ${JSON.stringify(chart)};\nvar value_changes = ${JSON.stringify(changes)};`, id, source, checkedAt);
}

function trade(sideA, sideB, fields = {}) {
  return normalizeTrades({ trades: [{
    trade_id: "trade", ts: observedAt, ts_latest: observedAt + 30,
    side_a_items: sideA, side_b_items: sideB, ...fields,
  }] });
}

test("prices both baskets with copy counts and keeps historical OP separate from current OP", () => {
  const input = trade(
    [{ asset_id: 1, quantity: 2, value_then: 2000, rap: 1500 }],
    [{ asset_id: 2, uaid: "31", value_then: 0, rap: 620 }, { asset_id: 2, uaid: "32", rap: 620 }],
  );
  const changes = [[midnight, 1, null, 1800], [observedAt + 100, 1, 1800, 2000]];
  const [result] = resolveTrades(input, new Map([["1", profile("1", 2000, changes)], ["2", profile("2", null)]]));
  assert.deepEqual(result.robux, { sideA: null, sideB: null });
  assert.deepEqual(result.historicalItemOnlyOverpay, {
    sideATotal: 3600, sideBTotal: 1200, signedOverpay: -2400, overpayPercent: -2400 / 3600 * 100,
  });
  assert.deepEqual(result.currentItemOnlyOverpay, {
    sideATotal: 4000, sideBTotal: 1800, signedOverpay: -2200, overpayPercent: -2200 / 4000 * 100,
  });
  assert.deepEqual(result.sideB[0].historical, {
    method: "rap-snapshot", value: 600, effectiveAt: "2026-11-25T00:00:00.000Z", source: "https://www.rolimons.com/item/2",
  });
  assert.equal(result.sideA[0].valueThenComparison, "different-value");
  assert.equal(result.sideB[0].valueThen, 0);
  assert.equal(result.sideB[1].valueThen, null);
  assert.equal(coverage([result]).historicalRapCopies, 2);
});

test("leaves missing RAP dates, unknown quantities and ambiguous Value states unresolved", () => {
  const changes = [[midnight, 1, null, 1000], [observedAt + 30, 1, 1000, null]];
  const input = trade(
    [{ asset_id: 1, value_then: null }, { asset_id: 2, value_then: 0 }],
    [{ asset_id: 3, quantity: 0 }],
  );
  const [result] = resolveTrades(input, new Map([
    ["1", profile("1", null, changes)], ["2", profile("2", null, [], midnight - 60)], ["3", profile("3", null)],
  ]));
  assert.equal(result.sideA[0].historicalUnavailable, "assigned-value-changed-during-observation");
  assert.equal(result.sideA[1].historicalUnavailable, "no-prior-rap-snapshot-on-trade-date");
  assert.equal(result.sideB[0].quantity, null);
  assert.equal(result.historicalItemOnlyOverpay.sideBTotal, null);
  assert.equal(result.historicalItemOnlyOverpay.signedOverpay, null);
  assert.equal(result.currentItemOnlyOverpay.sideATotal, 1800);
  assert.equal(result.currentItemOnlyOverpay.signedOverpay, null);
});

test("uses the prior RAP snapshot and audits provider Value at the copy observation", () => {
  const input = trade(
    [{ asset_id: 1, ts: observedAt - 300, value_then: 1500 }],
    [{ asset_id: 2, rap: 700 }],
    { ts: observedAt, ts_latest: observedAt },
  );
  const changes = [[midnight, 1, null, 1500], [observedAt, 1, 1500, 2000]];
  const [result] = resolveTrades(input, new Map([
    ["1", profile("1", 2000, changes)], ["2", profile("2", null, [], observedAt + 1, 700)],
  ]));
  assert.equal(result.sideA[0].historical.value, 2000);
  assert.equal(result.sideA[0].valueThenComparison, "match");
  assert.equal(result.sideB[0].historical, null);
  assert.equal(result.historicalItemOnlyOverpay.overpayPercent, null);
});

test("accepts normalized Roxol exports and preserves explicit zero RAP", () => {
  const input = normalizeTrades({ trades: [{
    tradeId: "normalized",
    firstObservedAt: new Date(observedAt * 1000).toISOString(),
    sideA: [{ assetId: "1", quantity: 1 }],
    sideB: [{ assetId: "2", quantity: 1 }],
  }] });
  const [result] = resolveTrades(input, new Map([
    ["1", profile("1", null, [], midnight, 0)], ["2", profile("2", null)],
  ]));
  assert.equal(result.historicalItemOnlyOverpay.sideATotal, 0);
  assert.equal(result.historicalItemOnlyOverpay.signedOverpay, 600);
  assert.equal(result.historicalItemOnlyOverpay.overpayPercent, null);
});

test("leaves RAP unresolved when the observed exchange spans two UTC dates", () => {
  const input = trade([{ asset_id: 1 }], [{ asset_id: 2 }], { ts: midnight - 20 });
  const [result] = resolveTrades(input, new Map([
    ["1", profile("1", null)], ["2", profile("2", 1000, [[midnight - 60, 1, null, 1000]])],
  ]));
  assert.equal(result.sideA[0].historicalUnavailable, "trade-observations-span-utc-dates");
  assert.equal(result.sideB[0].historical.value, 1000);
});
