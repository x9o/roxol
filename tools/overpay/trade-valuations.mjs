import { assignmentAt, parseHistory } from "./history.mjs";

function amount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function timestamp(seconds) {
  const time = seconds * 1000;
  return typeof seconds === "number" && Number.isSafeInteger(time) && time > 0 && time <= 8.64e15
    ? time : null;
}

function iso(time) {
  return time === null ? null : new Date(time).toISOString();
}

function sameUtcDay(left, right) {
  const day = 86_400_000;
  return Math.floor(left / day) === Math.floor(right / day);
}

function embeddedJson(html, name) {
  const match = new RegExp(`\\bvar ${name}\\s*=\\s*(\\{[^\\r\\n]*\\})\\s*;`).exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function parseItemProfile(html, id, source, checkedAt) {
  const details = embeddedJson(html, "item_details_data");
  if (String(details?.item_id) !== id ||
      (details.value !== null && !(amount(details.value) > 0))) return null;
  const trackedFrom = timestamp(details.first_timestamp);
  const history = parseHistory(html, { kind: "asset", id }, details.value, source, trackedFrom);
  const chart = embeddedJson(html, "history_data");
  const rap = [];
  if (Array.isArray(chart?.timestamp) && Array.isArray(chart.rap) &&
      chart.timestamp.length === chart.rap.length && chart.num_points === chart.rap.length) {
    for (const [index, seconds] of chart.timestamp.entries()) {
      const time = timestamp(seconds);
      if (!time || time <= (rap.at(-1)?.[0] ?? 0) || time > checkedAt) {
        rap.length = 0;
        break;
      }
      rap.push([time, amount(chart.rap[index])]);
    }
  }
  return { checkedAt, source, history, rap, currentValue: details.value, currentRap: amount(details.rap) };
}

function rapAt(profile, time) {
  if (!profile || time === null || time > profile.checkedAt) return null;
  const point = profile.rap.findLast(([sampledAt]) => sampledAt <= time);
  if (!point || point[1] == null || !sameUtcDay(point[0], time)) return null;
  return { method: "rap-snapshot", value: point[1], effectiveAt: iso(point[0]), source: profile.source };
}

function itemRow(row) {
  const id = row?.assetId ?? row?.asset_id;
  const assetId = (typeof id === "string" || Number.isSafeInteger(id)) && /^[1-9]\d{0,19}$/.test(String(id))
    ? String(id) : null;
  return {
    assetId, name: row?.name ?? null, quantity: row?.quantity === undefined ? 1 : amount(row.quantity) || null,
    userAssetId: row?.userAssetId ?? row?.uaid ?? null, instanceId: row?.instanceId ?? row?.ciid ?? null,
    serial: row?.serial ?? null,
    observedAt: iso(observation(row, "observedAt", "ts")),
    rap: amount(row?.rap), valueThen: amount(row?.valueThen ?? row?.value_then),
  };
}

function observation(row, field, rawField) {
  if (typeof row?.[field] === "string" && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(row[field])) {
    const time = Date.parse(row[field]);
    if (Number.isFinite(time) && time > 0) return time;
  }
  return timestamp(row?.[rawField]);
}

export function normalizeTrades(input) {
  if (!Array.isArray(input?.trades)) throw new Error("Expected a RoUtility response or Roxol export with a trades array.");
  const trades = new Map();
  for (const row of input.trades) {
    const tradeId = row?.tradeId ?? row?.trade_id;
    if (typeof tradeId !== "string" || !tradeId || (row.kind !== undefined && row.kind !== "trade")) continue;
    const a = row.sideA ?? row.side_a_items;
    const b = row.sideB ?? row.side_b_items;
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) continue;
    trades.set(tradeId, {
      tradeId, inferred: typeof row.inferred === "boolean" ? row.inferred : null,
      firstObservedAt: iso(observation(row, "firstObservedAt", "ts")),
      lastObservedAt: iso(observation(row, "lastObservedAt", "ts_latest")),
      sideA: a.map(itemRow), sideB: b.map(itemRow),
    });
  }
  return [...trades.values()];
}

function valueThenComparison(reported, assignment) {
  if (!assignment) return "unverified";
  if (!(reported > 0)) return assignment.value === null ? "no-assigned-value" : "missing-assigned-value";
  if (assignment.value === null) return "reported-for-unvalued-item";
  return assignment.value === reported ? "match" : "different-value";
}

function priceItem(item, profile, from, through) {
  const assignment = profile && through <= profile.checkedAt ? assignmentAt(profile.history, from, through) : null;
  const tradeDateKnown = sameUtcDay(from, through);
  const historical = assignment?.value > 0 ? { method: "assigned-value", ...assignment }
    : assignment && tradeDateKnown ? rapAt(profile, through) : null;
  const currentAmount = profile?.currentValue ?? profile?.currentRap;
  const current = currentAmount == null ? null : {
    method: profile.currentValue === null ? "rap-snapshot" : "assigned-value",
    value: currentAmount, effectiveAt: iso(profile.checkedAt), source: profile.source,
  };
  const itemTime = item.observedAt ? Date.parse(item.observedAt) : null;
  const itemAssignment = profile && itemTime !== null && itemTime <= profile.checkedAt
    ? assignmentAt(profile.history, itemTime) : null;
  const comparison = itemAssignment ?? (itemTime === null ? assignment : null);
  return {
    ...item, assignment, historical, current, profileObservedAt: profile ? iso(profile.checkedAt) : null,
    historicalUnavailable: historical ? null : !profile ? "profile-unavailable" : !assignment
      ? "assigned-value-history-unresolved" : !tradeDateKnown
        ? "trade-observations-span-utc-dates" : "no-prior-rap-snapshot-on-trade-date",
    valueThenComparison: valueThenComparison(item.valueThen, comparison),
    valueThenReference: comparison,
    rapAtItemObservation: rapAt(profile, itemTime),
  };
}

function basketTotal(items, field) {
  let total = 0;
  for (const item of items) {
    if (item.quantity == null || item[field]?.value == null) return null;
    total += item.quantity * item[field].value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function itemOnlyOverpay(sideA, sideB, field) {
  const sideATotal = basketTotal(sideA, field);
  const sideBTotal = basketTotal(sideB, field);
  const signedOverpay = sideATotal === null || sideBTotal === null ? null : sideBTotal - sideATotal;
  return {
    sideATotal, sideBTotal, signedOverpay,
    overpayPercent: signedOverpay === null || !sideATotal ? null : signedOverpay / sideATotal * 100,
  };
}

export function resolveTrades(trades, profiles) {
  return trades.map((trade) => {
    const first = Date.parse(trade.firstObservedAt);
    const last = Date.parse(trade.lastObservedAt);
    const from = Number.isFinite(first) ? first : last;
    const through = Number.isFinite(last) ? last : first;
    const price = (item) => priceItem(item, profiles.get(item.assetId), from, through);
    const sideA = trade.sideA.map(price);
    const sideB = trade.sideB.map(price);
    return {
      ...trade, sideA, sideB,
      valuationAt: Number.isFinite(through) && through >= from ? iso(through) : null,
      robux: { sideA: null, sideB: null },
      historicalItemOnlyOverpay: itemOnlyOverpay(sideA, sideB, "historical"),
      currentItemOnlyOverpay: itemOnlyOverpay(sideA, sideB, "current"),
    };
  });
}

export function coverage(trades) {
  const items = (trade) => [...trade.sideA, ...trade.sideB];
  const rows = trades.flatMap(items);
  const count = (predicate) => rows.reduce((sum, item) => sum + (predicate(item) ? item.quantity ?? 0 : 0), 0);
  const tally = (field) => Object.fromEntries(Object.entries(Object.groupBy(rows, (item) => item[field]))
    .map(([key, entries]) => [key, entries.reduce((sum, item) => sum + (item.quantity ?? 0), 0)]));
  return {
    trades: trades.length, itemRows: rows.length, knownCopies: count(() => true),
    rowsWithUnknownQuantity: rows.filter((item) => item.quantity === null).length,
    positiveValueThenCopies: count((item) => item.valueThen > 0),
    zeroValueThenCopies: count((item) => item.valueThen === 0),
    missingValueThenCopies: count((item) => item.valueThen === null),
    positiveRapCopies: count((item) => item.rap > 0),
    fullyPositiveValueThenTrades: trades.filter((trade) => items(trade)
      .every((item) => item.quantity !== null && item.valueThen > 0)).length,
    historicalAssignedValueCopies: count((item) => item.historical?.method === "assigned-value"),
    historicalRapCopies: count((item) => item.historical?.method === "rap-snapshot"),
    fullyHistoricallyPricedTrades: trades.filter((trade) => trade.historicalItemOnlyOverpay.signedOverpay !== null).length,
    fullyCurrentlyPricedTrades: trades.filter((trade) => trade.currentItemOnlyOverpay.signedOverpay !== null).length,
    valueThenComparisons: tally("valueThenComparison"),
    unresolvedHistoricalCopies: count((item) => item.historical === null),
  };
}
