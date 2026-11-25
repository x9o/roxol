const day = 86400000;

function canonicalBasket(basket) {
  return basket.map(({ kind, id, quantity, copyId, serial }) => [kind, id, quantity, copyId ?? "", serial ?? ""].join(":"))
    .sort().join(",");
}

export function validBasket(basket) {
  return Array.isArray(basket) && basket.length > 0 && basket.every((item) =>
    ["asset", "bundle"].includes(item.kind) && /^[1-9]\d{0,19}$/.test(item.id) &&
    Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 4) &&
    basket.reduce((sum, item) => sum + item.quantity, 0) <= 4;
}

export function shapeFor(baskets, side) {
  const [target, opposite] = [baskets[side], baskets[1 - side]];
  if (!validBasket(target) || !validBasket(opposite) || target.length !== 1 || target[0].quantity !== 1) return null;
  if (opposite.some((item) => item.kind === target[0].kind && item.id === target[0].id)) return null;
  return opposite.reduce((sum, item) => sum + item.quantity, 0) === 1 ? "swap" : "one-for-many";
}

export function priceTarget(prices, side) {
  const targetValue = prices[side][0].price.value;
  const other = prices[1 - side];
  return {
    overpay: other.reduce((sum, entry) => sum + entry.price.value * entry.quantity, 0) - targetValue,
    majorItems: other.filter((entry) => entry.price.value > targetValue / 2),
  };
}

export function deduplicate(trades) {
  const indexes = new Map();
  const groups = new Set();
  for (const trade of trades) {
    const civilDate = trade.date.slice(0, 10);
    const sides = trade.baskets.map((basket, i) => JSON.stringify([
      trade.participants[i].toLowerCase(), canonicalBasket(basket), trade.robux[i],
    ])).sort();
    const fingerprint = JSON.stringify([civilDate, sides]);
    const keys = [trade.tradeId && "trade:" + trade.tradeId, "fields:" + fingerprint,
      ...trade.hashes.map((hash) => "image:" + hash)].filter(Boolean);
    const matches = [...new Set(keys.map((key) => indexes.get(key)).filter(Boolean))];
    const group = matches.shift() ?? { trade, fingerprint, links: new Set(), keys: new Set(), conflict: false };
    groups.add(group);
    group.links.add(trade.link);
    group.conflict ||= group.fingerprint !== fingerprint ||
      Boolean(group.trade.tradeId && trade.tradeId && group.trade.tradeId !== trade.tradeId);
    for (const other of matches) {
      groups.delete(other);
      group.conflict ||= other.conflict || other.fingerprint !== group.fingerprint ||
        Boolean(group.trade.tradeId && other.trade.tradeId && group.trade.tradeId !== other.trade.tradeId);
      for (const link of other.links) group.links.add(link);
      for (const key of other.keys) group.keys.add(key);
    }
    for (const key of keys) group.keys.add(key);
    for (const key of group.keys) indexes.set(key, group);
    if ((trade.date.includes("T") && !group.trade.date.includes("T")) || (!group.trade.tradeId && trade.tradeId)) group.trade = trade;
  }
  return [...groups].map(({ trade, links, conflict }) => ({ ...trade, links: [...links], conflict }));
}

export function percentile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

export function aggregate(samples, now = Date.now(), minimum = 10) {
  const start = now - 30 * day;
  const priorStart = start - 30 * day;
  const current = samples.filter(({ time }) => time > start && time <= now);
  const previous = samples.filter(({ time }) => time > priorStart && time <= start);
  const base = {
    count: current.length, previousCount: previous.length, minimum,
    window: { from: new Date(start).toISOString(), to: new Date(now).toISOString() },
    links: [...new Set(current.flatMap(({ links }) => links))],
  };
  if (current.length < minimum) return base;
  const values = current.map(({ overpay }) => overpay).sort((a, b) => a - b);
  const median = percentile(values, 0.5);
  return {
    ...base, median, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    middle50: [percentile(values, 0.25), percentile(values, 0.75)],
    trend: previous.length >= minimum ? median - percentile(previous.map(({ overpay }) => overpay).sort((a, b) => a - b), 0.5) : null,
  };
}
