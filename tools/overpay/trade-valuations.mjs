import valuation from "../../extension/shared/trade-valuations.js";

const { amount, timestamp, iso } = valuation;
export const { parseItemProfile, resolveTrades } = valuation;

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
