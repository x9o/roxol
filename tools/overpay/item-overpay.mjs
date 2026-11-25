import { percentile } from "./stats.mjs";
import { assetCopies } from "./trade-validation.mjs";

const recentDays = 30;
const thinBelow = 10;
const imbalanceRatio = 2;
const groups = ["swap", "upgrade", "downgrade"];

function distribution(values) {
  if (!values.length) return { median: null, quartiles: null, iqr: null };
  const sorted = values.sort((a, b) => a - b);
  const quartiles = [percentile(sorted, 0.25), percentile(sorted, 0.75)];
  return { median: percentile(sorted, 0.5), quartiles, iqr: quartiles[1] - quartiles[0] };
}

function summarize(samples, now) {
  const priced = samples.filter(({ overpay }) => overpay !== null);
  const times = samples.map(({ time }) => new Date(time).toISOString()).sort();
  const pricedTimes = priced.map(({ time }) => new Date(time).toISOString()).sort();
  const balanced = priced.filter(({ imbalanced }) => !imbalanced);
  return {
    sampleSize: priced.length,
    thinSample: priced.length < thinBelow,
    valuationCoverage: {
      eligibleTrades: samples.length,
      pricedTrades: priced.length,
      fractionPriced: samples.length ? priced.length / samples.length : null,
      assignedValueOnly: priced.filter(({ basis }) => basis === "assigned-value").length,
      usesRap: priced.filter(({ basis }) => basis === "rap").length,
    },
    robuxCoverage: Object.fromEntries(["unknown", "reported-zero", "reported-nonzero"].map((status) =>
      [status, priced.filter(({ robux }) => robux === status).length])),
    recency: {
      firstObservedAt: times[0] ?? null,
      lastObservedAt: times.at(-1) ?? null,
      lastPricedObservationAt: pricedTimes.at(-1) ?? null,
      daysSinceLastPriced: pricedTimes.length ? (now - Date.parse(pricedTimes.at(-1))) / 86_400_000 : null,
    },
    overpay: distribution(priced.map(({ overpay }) => overpay)),
    overpayPercent: distribution(priced.map(({ percent }) => percent)),
    severeImbalances: priced.length - balanced.length,
    withinTwofoldValue: {
      sampleSize: balanced.length,
      medianOverpay: distribution(balanced.map(({ overpay }) => overpay)).median,
      medianOverpayPercent: distribution(balanced.map(({ percent }) => percent)).median,
    },
  };
}

function unusualComposition(sides) {
  const copies = sides.map(assetCopies);
  if (!copies.every(Boolean)) return "invalid-basket";
  const identifiers = sides.flat().flatMap(({ assetId, instanceId, userAssetId, serial }) => [
    instanceId && "instance:" + String(instanceId).toLowerCase(),
    userAssetId && "user-asset:" + userAssetId,
    /^[1-9]\d*$/.test(serial ?? "") && "serial:" + assetId + ":" + serial,
  ].filter(Boolean));
  if (new Set(identifiers).size < identifiers.length) return "duplicate-copy-id";
  const [left, right] = copies;
  if (left.some((item) => right.some(({ assetId }) => assetId === item.assetId))) return "same-asset-on-both-sides";
  if (left.length > 1 && right.length > 1) return "many-for-many";
  return null;
}

function targetSample(trade, side, time) {
  const totals = trade.historicalItemOnlyOverpay;
  const [target, opposite] = side === 0 ? [totals.sideATotal, totals.sideBTotal] : [totals.sideBTotal, totals.sideATotal];
  // A zero RAP snapshot gives no usable denominator or estimate for a basket.
  const items = [...trade.sideA, ...trade.sideB];
  const priced = target > 0 && opposite > 0 && items.every(({ historical }) => historical?.value > 0);
  const overpay = priced ? opposite - target : null;
  const robux = [trade.robux?.sideA, trade.robux?.sideB];
  return {
    time, overpay,
    percent: priced ? overpay / target * 100 : null,
    basis: items.every(({ historical }) => historical?.method === "assigned-value") ? "assigned-value" : "rap",
    imbalanced: priced && Math.max(opposite, target) / Math.min(opposite, target) > imbalanceRatio,
    robux: robux.some((amount) => amount > 0) ? "reported-nonzero" :
      robux.every((amount) => amount === 0) ? "reported-zero" : "unknown",
  };
}

export function itemOverpay(trades, now = Date.now()) {
  const items = new Map();
  const seen = new Set();
  for (const trade of trades) {
    if (seen.has(trade.tradeId)) continue;
    seen.add(trade.tradeId);
    const sides = [trade.sideA, trade.sideB];
    const time = Date.parse(trade.valuationAt);
    const exclusion = unusualComposition(sides) ??
      (!Number.isFinite(time) || time > now ? "invalid-observation-time" : null);
    const itemIds = new Set(sides.flat().map(({ assetId }) => assetId).filter(Boolean));
    for (const id of itemIds) {
      if (!items.has(id)) items.set(id, { observedTrades: 0, exclusions: {}, samples: { swap: [], upgrade: [], downgrade: [] } });
      const item = items.get(id);
      item.observedTrades++;
      const side = sides.findIndex((basket) => basket.length === 1 && basket[0].quantity === 1 && basket[0].assetId === id);
      const reason = exclusion ?? (side < 0 ? "target-bundled" : null);
      if (reason) {
        item.exclusions[reason] = (item.exclusions[reason] ?? 0) + 1;
        continue;
      }
      const sample = targetSample(trade, side, time);
      const other = sides[1 - side];
      if (other.length === 1 && other[0].quantity === 1) {
        item.samples.swap.push(sample);
      } else {
        item.samples.downgrade.push(sample);
        item.samples.upgrade.push({ ...sample, overpay: sample.overpay === null ? null : -sample.overpay,
          percent: sample.percent === null ? null : -sample.percent });
      }
    }
  }
  const recentStart = now - recentDays * 86_400_000;
  return {
    version: 1, asOf: new Date(now).toISOString(),
    metric: "Historical item-only value received minus value given, as a percentage of the focal item's value",
    perspectives: { swap: "Give the focal item", upgrade: "Receive the focal item", downgrade: "Give the focal item" },
    recentFromExclusive: new Date(recentStart).toISOString(), thinBelow, imbalanceRatio,
    items: Object.fromEntries([...items].map(([id, { samples, ...item }]) => [id, {
      ...item, groups: Object.fromEntries(groups.map((group) => [group, {
        recent: summarize(samples[group].filter(({ time }) => time > recentStart), now),
        allObserved: summarize(samples[group], now),
      }])),
    }])),
  };
}
