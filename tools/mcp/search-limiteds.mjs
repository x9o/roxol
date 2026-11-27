import { z } from "zod";
import market from "../../extension/background/public-market.js";
import targets from "../../extension/shared/market_targets.js";
import { readValueChanges, rolimonsFeed } from "./data.mjs";

const day = 86_400_000;
const historyBatchSize = 60;
const amount = z.number().int().nonnegative();
const days = z.union([z.literal(7), z.literal(30)]);
const sortFields = ["value", "rap", "lowest_ask", "demand", "sales", "change", "change_percent", "discount"];
const defaultSort = ({ price, sales, change, minDiscountPercent }) =>
  change ? "change" : sales ? "sales" : minDiscountPercent !== undefined ? "discount" : price?.basis ?? "value";

export const searchLimitedsInput = z.strictObject({
  price: z.strictObject({
    basis: z.enum(["value", "rap", "lowest_ask"]),
    min: amount.optional(),
    max: amount.optional(),
  }).refine(({ min, max }) => (min !== undefined || max !== undefined) && (min ?? 0) <= (max ?? Infinity),
    "Provide at least one price bound, with min no greater than max.").optional().describe("Inclusive Robux bounds."),
  demand: z.array(z.enum(["Terrible", "Low", "Normal", "High", "Amazing"])).min(1).max(5).optional(),
  trend: z.array(z.enum(["Lowering", "Unstable", "Stable", "Raising", "Fluctuating"])).min(1).max(5).optional(),
  excludeProjected: z.boolean().default(false),
  excludeGear: z.boolean().default(false),
  sales: z.strictObject({ days, minSold: amount.optional() }).optional()
    .describe("Window for the sales sort and resale evidence. Set minSold to filter by Roblox recorded volume."),
  change: z.strictObject({
    basis: z.enum(["value", "rap"]),
    days: z.number().int().min(1).max(180),
    direction: z.enum(["rising", "falling"]).optional(),
  }).optional().describe("Measure change over this window. Set direction to filter out flat and opposite moves."),
  minDiscountPercent: z.number().min(0).max(100).optional()
    .describe("Minimum discount from assigned Value to the Roblox lowest resale ask, in percentage points."),
  sort: z.enum(sortFields).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(25).default(10),
  candidateOffset: amount.default(0).describe("For broad history searches, reuse the filters and pass scope.nextCandidateOffset."),
}).refine((args) => !["change", "change_percent"].includes(args.sort) || Boolean(args.change),
  "Change sorts require a change window.").refine((args) =>
  !args.candidateOffset || Boolean(args.change) || (args.sort ?? defaultSort(args)) === "sales" ||
  args.sales?.minSold !== undefined, "A candidate offset only applies to searches that evaluate history across candidates.");

const iso = (time) => new Date(time).toISOString();
const percent = (difference, base) => base > 0 ? 100 * difference / base : null;
const compareItems = (a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
const inRange = (value, { min = 0, max = Infinity }) => value !== null && value >= min && value <= max;

async function mapBatches(items, size, read) {
  const results = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...await Promise.all(items.slice(start, start + size).map(read)));
  }
  return results;
}

async function catalogRows(items) {
  const batches = [];
  for (let start = 0; start < items.length; start += 100) batches.push(items.slice(start, start + 100));
  return (await mapBatches(batches, 4, (batch) => market.readDetails(batch))).flat();
}

function listing(detail) {
  const price = detail?.lowestAsk ?? null;
  const status = price !== null ? "ok" : detail?.hasResellers === false ? "no_listing" : "unavailable";
  return { status, price, source: market.catalogUrl, checkedAt: detail ? iso(detail.checkedAt) : null };
}

function saleVolume(data, now, days) {
  const end = Math.floor(now / day) * day;
  const start = end - days * day;
  // The legacy endpoint can return a frozen pre-migration history for collectible assets.
  const latestPoint = Math.max(data.volumeDays?.[0]?.[0] ?? 0, data.daily?.[0]?.time_ms ?? 0);
  const stale = data.source?.startsWith("https://economy.roblox.com/") && latestPoint < end - 30 * day;
  const incomplete = data.daily?.some(({ time_ms: time, volume }) => time >= start && time < end && volume === null);
  const volumes = stale || incomplete ? null : data.volumeDays?.filter(([time]) => time >= start && time < end);
  const latestSaleDay = volumes?.find(([, count]) => count > 0)?.[0];
  return {
    status: volumes ? "ok" : stale ? "stale" : "unavailable",
    source: data.source ?? null, checkedAt: data.checkedAt ? iso(data.checkedAt) : null,
    from: iso(start), throughExclusive: iso(end),
    copiesSold: volumes ? volumes.reduce((sum, [, count]) => sum + count, 0) : null,
    latestSaleDay: latestSaleDay ? iso(latestSaleDay) : null,
  };
}

function salesEvidence(item, tracked, from, now) {
  const sales = tracked.sales?.filter(({ time }) => time <= now) ?? [];
  const windowSales = sales.filter(({ time }) => time >= from);
  const prices = windowSales.map(({ price }) => price).filter((price) => price > 0).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2;
  return {
    status: tracked.status, source: targets.rolimonsSalesUrl(item),
    checkedAt: tracked.checkedAt ? iso(tracked.checkedAt) : null,
    from: iso(from), through: iso(now),
    providerTrackedCount: tracked.count ?? null,
    oldestReturnedSaleAt: sales.length ? iso(sales.at(-1).time) : null,
    windowCovered: tracked.status === "ok" &&
      (sales.at(-1)?.time <= from || trackedCoversAll(tracked)),
    pricedSalesInWindow: prices.length,
    medianSalePrice: prices.length ? median : null,
    latestTrackedSaleAt: sales.length ? iso(sales[0].time) : null,
    recentSales: sales.filter(({ price }) => price > 0).slice(0, 3).map(({ time, price }) => ({ at: iso(time), price })),
  };
}

function measuredChange({ basis, days }, item, data, cutoff, now) {
  const source = basis === "value" ? data.source : targets.rolimonsSalesUrl(item);
  const end = item[basis];
  let start = null;
  let startEvidenceAt = null;
  if (basis === "value") {
    const changes = data.changes ?? [];
    const latest = changes.at(-1);
    if (latest && latest.time <= now && latest.after === end) {
      const prior = changes.findLast(({ time }) => time <= cutoff);
      const next = prior ?? changes[0];
      const value = prior ? next.after : next.before;
      start = targets.amount(value) || null;
      startEvidenceAt = start === null ? null : iso(next.time);
    }
  } else {
    const sales = data.sales?.filter(({ time }) => time <= now) ?? [];
    const prior = sales.find(({ time }) => time <= cutoff);
    const next = sales.findLast(({ time }) => time > cutoff);
    // Pre-sale RAP on the first post-cutoff sale fills gaps where that earlier sale has no post-sale figure.
    if (prior || (next && trackedCoversAll(data))) {
      start = prior?.after ?? next?.before ?? null;
      startEvidenceAt = start === null ? null : iso(prior?.after != null ? prior.time : next.time);
    }
  }
  const difference = start > 0 && end > 0 ? end - start : null;
  return {
    basis, days, from: iso(cutoff), start, startEvidenceAt,
    end, endObservedAt: iso(item.checkedAt), difference,
    percent: difference === null ? null : percent(difference, start), source,
  };
}

function trackedCoversAll({ count, sales }) {
  return count !== null && count === sales?.length;
}

function valueHistory(item) {
  if (!item.value) return { status: "not_applicable", latestChangeAt: null };
  return readValueChanges(item).then(({ changes, ...metadata }) => ({
    ...metadata, changes,
    latestChangeAt: changes?.length ? iso(changes.at(-1).time) : null,
  }));
}

function changeGap(item, data, delta, now) {
  let reason = data.reason ?? data.status;
  if (data.status === "ok") {
    const latest = data.changes?.at(-1);
    if (delta.basis === "value" && !latest) reason = "empty_history";
    else if (latest?.time > now) reason = "future_history";
    else if (latest && latest.after !== item.value) reason = "snapshot_mismatch";
    else reason = "no_cutoff_value";
  }
  return {
    id: item.id, kind: item.kind, name: item.name, reason, source: delta.source,
    ...(data.httpStatus !== undefined ? { httpStatus: data.httpStatus } : {}),
    ...(data.retryAt ? { retryAt: data.retryAt } : {}),
  };
}

export async function searchLimiteds({
  price, demand, trend, excludeProjected, excludeGear, sales, change, minDiscountPercent,
  sort = defaultSort({ price, sales, change, minDiscountPercent }),
  order = sort === "lowest_ask" || (["change", "change_percent"].includes(sort) && change?.direction === "falling")
    ? "asc" : "desc", limit, candidateOffset,
}) {
  const feed = await market.readItemFeed();
  const now = Date.now();
  const salesDays = sales?.days ?? 30;
  const from = now - salesDays * day;
  const cutoff = now - (change?.days ?? 0) * day;
  const rankByVolume = sort === "sales" || sales?.minSold !== undefined;
  const usesAsk = price?.basis === "lowest_ask" || minDiscountPercent !== undefined || ["lowest_ask", "discount"].includes(sort);
  const usesDiscount = minDiscountPercent !== undefined || sort === "discount";
  const historySearch = rankByVolume || Boolean(change);
  const source = { source: rolimonsFeed, status: feed ? "ok" : "unavailable",
    checkedAt: feed ? iso(feed.values().next().value.checkedAt) : null };
  const scope = { catalogItems: feed?.size ?? 0, candidates: 0, evaluated: 0, candidateOffset,
    nextCandidateOffset: null, missingCatalogData: 0, missingVolumeData: 0, missingChangeData: 0,
    changeGaps: [], retryAt: null };
  const response = { asOf: iso(now), sort: { by: sort, order }, salesDays, scope, sources: { rolimons: source } };
  if (!feed) return { status: "unavailable", ...response, matched: 0, items: [] };

  let candidates = [...feed].map(([key, row]) => {
    const [kind, id] = key.split(":");
    return { kind, id, ...row, value: row.value || null };
  }).filter((item) =>
    (!demand || demand.includes(item.demand)) && (!trend || trend.includes(item.trend)) &&
    (!excludeProjected || item.projected === false) &&
    (!usesDiscount || item.value !== null) && (change?.basis !== "value" || item.value !== null) &&
    (!price || price.basis === "lowest_ask" || inRange(item[price.basis], price)));

  if (excludeGear || usesAsk) {
    const details = await catalogRows(candidates);
    candidates = candidates.filter((item, index) => {
      const detail = details[index];
      if (excludeGear && item.kind === "asset" && detail?.assetType === 19) return false;
      item.listing = listing(detail);
      if (usesAsk && item.listing.status === "no_listing") return false;
      if ((excludeGear && item.kind === "asset" && detail?.assetType == null) ||
          (usesAsk && item.listing.status !== "ok")) {
        scope.missingCatalogData++;
        return false;
      }
      item.discountPercent = item.listing.price === null ? null : percent(item.value - item.listing.price, item.value);
      return (price?.basis !== "lowest_ask" || inRange(item.listing.price, price)) &&
        (minDiscountPercent === undefined || item.discountPercent >= minDiscountPercent);
    });
  }

  scope.candidates = candidates.length;
  if (historySearch) {
    candidates.sort((a, b) => (rankByVolume ? b.demandRating - a.demandRating : 0) ||
      (b.value ?? b.rap ?? 0) - (a.value ?? a.rap ?? 0) || compareItems(a, b));
    const end = candidateOffset + historyBatchSize;
    scope.nextCandidateOffset = end < candidates.length ? end : null;
    candidates = candidates.slice(candidateOffset, end);
  }
  scope.evaluated = candidates.length;
  if (rankByVolume) await catalogRows(candidates);
  const evaluated = historySearch ? await mapBatches(candidates, 4, async (item) => {
    const volume = rankByVolume ? saleVolume(await market.readResale(item), now, salesDays) : null;
    if (rankByVolume && volume.copiesSold === null) {
      scope.missingVolumeData++;
      return null;
    }
    if (sales?.minSold !== undefined && volume.copiesSold < sales.minSold) return null;
    const [changes, tracked] = await Promise.all([
      change?.basis === "value" ? valueHistory(item) : null,
      change?.basis === "rap" ? market.readTrackedSales(item) : null,
    ]);
    const delta = change ? measuredChange(change, item, changes ?? tracked, cutoff, now) : null;
    if (change && delta.difference === null) {
      return { gap: changeGap(item, changes ?? tracked, delta, now) };
    }
    if ((change?.direction === "rising" && delta.difference <= 0) ||
        (change?.direction === "falling" && delta.difference >= 0)) return null;
    return { ...item, volume, changes, tracked, delta };
  }) : candidates;
  scope.changeGaps = evaluated.flatMap((item) => item?.gap ? [item.gap] : []);
  scope.missingChangeData = scope.changeGaps.length;
  scope.retryAt = scope.changeGaps.reduce((latest, { retryAt }) => retryAt && (!latest || retryAt > latest) ? retryAt : latest, null);

  const score = (item) => ({
    value: item.value, rap: item.rap, lowest_ask: item.listing?.price, demand: item.demandRating || null,
    sales: item.volume?.copiesSold, change: item.delta?.difference, change_percent: item.delta?.percent,
    discount: item.discountPercent,
  })[sort];
  const matches = evaluated.filter((item) => item && !item.gap && score(item) != null);
  matches.sort((a, b) => (score(a) - score(b)) * (order === "asc" ? 1 : -1) || compareItems(a, b));
  const shortlist = matches.slice(0, limit);
  const details = shortlist.some((item) => !item.listing) ? await catalogRows(shortlist) : [];
  const items = await mapBatches(shortlist.map((item, index) => ({ item, index })), 4, async ({ item, index }) => {
    const [tracked, volume, changes] = await Promise.all([
      item.tracked ?? market.readTrackedSales(item),
      item.volume ?? market.readResale(item).then((data) => saleVolume(data, now, salesDays)),
      change ? item.changes ?? valueHistory(item) : null,
    ]);
    const ask = item.listing ?? listing(details[index]);
    return {
      rank: index + 1, sortValue: score(item), id: item.id, kind: item.kind,
      name: item.name, acronym: item.acronym, url: targets.robloxItemUrl(item),
      value: item.value, rap: item.rap, demand: item.demand, trend: item.trend, projected: item.projected,
      lowestAsk: ask,
      discountPercent: ask.price === null ? null : percent(item.value - ask.price, item.value),
      sales: { days: salesDays, roblox: volume, tracked: salesEvidence(item, tracked, from, now) },
      ...(change ? { change: item.delta, valueHistory: {
        status: changes.status, source: changes.source ?? null, latestChangeAt: changes.latestChangeAt,
      } } : {}),
    };
  });
  const partial = candidateOffset > 0 || scope.nextCandidateOffset !== null ||
    scope.missingCatalogData > 0 || scope.missingVolumeData > 0 || scope.missingChangeData > 0;
  return { status: partial ? "partial" : "ok", ...response, matched: matches.length, items };
}
