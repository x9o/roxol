import { z } from "zod";
import { copyHistory, findItems, history, itemStatsBatch, tradeProofs } from "./data.mjs";
import { proofOrigin } from "./proofs.mjs";
import targets from "../../extension/shared/market_targets.js";

const { idOf, copyIdOf, keyOf } = targets;
const id = z.string().regex(/^[1-9]\d{0,19}$/);
const kind = z.enum(["asset", "bundle"]);
const query = z.string().trim().min(1).max(100);
const instanceId = z.string().trim().refine((value) => copyIdOf(value) && !idOf(value),
  "Provide a collectible instance UUID.").transform((value) => value.toLowerCase());
const itemInput = z.strictObject({
  id: id.optional(), query: query.optional(), kind: kind.optional(),
  quantity: z.number().int().min(1).max(4).default(1),
  uaid: id.optional(), collectibleInstanceId: instanceId.optional(),
}).refine(({ id, query, uaid, collectibleInstanceId, quantity }) =>
  !(id && query) && Boolean(id || query || uaid || collectibleInstanceId) &&
    (!(uaid || collectibleInstanceId) || quantity === 1),
"Provide an item ID, name/acronym, or copy ID. Each identified copy occupies one slot.");
const sideInput = z.strictObject({
  items: z.array(z.union([query, itemInput])).max(4).default([]),
  robux: z.number().int().min(0).max(1_000_000_000).default(0)
    .describe("Gross Robux offered by this side, before the trade fee."),
}).refine(({ items }) => items.reduce((n, item) => n + (item.quantity ?? 1), 0) <= 4,
  "A trade side may contain up to four copies.");

export const tradeContextInput = z.strictObject({
  give: sideInput.optional().describe("Your offer."),
  receive: sideInput.optional().describe("The other player's offer."),
  tradeId: id.optional(),
  proofLimit: z.number().int().min(0).max(10).default(3).describe("Maximum proof posts per distinct item. Zero skips proofs."),
  ownershipLimit: z.number().int().min(0).max(20).default(0)
    .describe("Maximum ownership observations per known copy. Zero omits history."),
}).refine(({ give, receive, tradeId }) => tradeId || give?.items.length || receive?.items.length || give?.robux || receive?.robux,
  "Provide a trade ID or at least one item or Robux amount.");

function sourceIndex() {
  const sources = [];
  const indexed = new Map();
  return {
    sources,
    ref({ source: url, status, checkedAt, httpStatus, reason, message }) {
      const metadata = { url, status, checkedAt: checkedAt ?? undefined, httpStatus, reason, message };
      const key = JSON.stringify(metadata);
      if (!indexed.has(key)) {
        indexed.set(key, sources.length);
        sources.push(metadata);
      }
      return indexed.get(key);
    },
  };
}

function copyIds({ uaid, collectibleInstanceId }) {
  return { ...(uaid ? { uaid } : {}), ...(collectibleInstanceId ? { collectibleInstanceId } : {}) };
}

async function resolveItem(input, lookUpCopy, ref, ownershipLimit) {
  const { id, query, kind, quantity = 1, ...copy } = typeof input === "string"
    ? { query: input } : input;
  const hasCopy = Boolean(copy.uaid || copy.collectibleInstanceId);
  const numericId = id ?? idOf(query);
  const entry = { quantity };
  let target = numericId ? { kind: kind ?? "asset", id: numericId } : null;
  let lookup;
  if (query && !numericId) {
    const search = await findItems({ query, kind, exact: true, limit: 4 });
    if (search.total === 1) {
      const [match] = search.items;
      target = { kind: match.kind, id: match.id };
    } else {
      entry.query = query;
      entry.resolution = search.status === "unavailable" ? "unavailable" : search.total ? "ambiguous" : "not_found";
      entry.searchSources = Object.values(search.sources).map(ref);
      if (search.total) entry.matches = search.items.map(({ id, kind, name }) => ({ id, kind, name }));
    }
  }
  if (hasCopy) {
    entry.copy = copyIds(copy);
    if ((ownershipLimit && target) || (!numericId && !query)) {
      lookup = await lookUpCopy(copy);
      entry.copySource = ref(lookup);
      if (lookup.status === "ok") {
        const tracked = lookup.copy;
        const mismatch = (kind && kind !== "asset") || (target && (target.kind !== "asset" || target.id !== tracked.assetId)) ||
          (copy.uaid && tracked.uaid && copy.uaid !== tracked.uaid) ||
          (copy.collectibleInstanceId && tracked.collectibleInstanceId && copy.collectibleInstanceId !== tracked.collectibleInstanceId);
        const unverifiedPair = copy.uaid && copy.collectibleInstanceId && (!tracked.uaid || !tracked.collectibleInstanceId);
        if (mismatch || unverifiedPair) {
          entry.copyStatus = mismatch ? "mismatch" : "unverified_copy_ids";
          lookup = undefined;
        } else {
          entry.copy = { ...entry.copy, ...copyIds(tracked), ...(tracked.serial ? { serial: tracked.serial } : {}) };
          target ??= { kind: "asset", id: tracked.assetId };
        }
      } else {
        entry.copyStatus = lookup.status;
      }
    }
  }
  if (target) entry.item = keyOf(target);
  else entry.resolution ??= "unresolved_copy";
  return { entry, target, lookup };
}

function compactOwnership(lookup, limit, source) {
  const distinct = new Map();
  for (const [index, row] of [lookup.currentOwner, ...lookup.records].entries()) {
    if (!row) continue;
    const key = JSON.stringify([row.at, row.ownerId ?? row.username]);
    const previous = distinct.get(key);
    distinct.set(key, { ...previous, ...row, ...(index === 0 ? { current: true } : {}) });
  }
  const ordered = [...distinct.values()].sort((a, b) => b.at.localeCompare(a.at));
  return { source, ...(lookup.hasMore || ordered.length > limit ? { hasMore: true } : {}), records: ordered.slice(0, limit) };
}

function itemSnapshot(stats, resale, ref) {
  const { rolimons, routility, roblox, robloxBestPrice, rolimonsDailySales } = stats;
  const roli = rolimons.data;
  const utility = routility.data;
  const native = roblox.data;
  const sources = Object.fromEntries(Object.entries({
    rolimons, routility, roblox, robloxBestPrice, rolimonsDailySales,
  }).map(([name, metadata]) => [name, ref(metadata)]));
  const rap = roli?.rap ?? native?.rap ?? resale.rap ?? utility?.rap ?? null;
  const rapProvider = roli?.rap != null ? "rolimons" : native?.rap != null ? "roblox"
    : resale.rap != null ? "robloxResale" : utility?.rap != null ? "routility" : undefined;
  const value = roli?.value ?? (utility?.value > 0 ? utility.value : null) ?? roli?.fallbackValue ?? rap;
  const valueBasis = roli?.value != null ? "rolimons_assigned" : utility?.value > 0 ? "routility_assigned"
    : roli?.fallbackValue != null && roli.fallbackValue !== rap ? "rolimons_fallback"
      : value != null ? "rap" : undefined;
  const details = Object.fromEntries(Object.entries({
    name: (roli?.name ?? native?.name ?? utility?.name)?.trim(),
    acronym: (roli?.acronym ?? utility?.acronym)?.trim(),
    demand: roli?.demand ?? utility?.demand,
    trend: roli?.trend ?? utility?.trend,
    projected: roli?.projected ?? utility?.projected,
    rare: roli?.rare, hyped: utility?.hyped, copies: utility?.copies,
    bestPrice: robloxBestPrice.price ?? utility?.bestPrice,
    dailySales: rolimonsDailySales.average,
  }).filter(([, value]) => value != null));
  return {
    ...details, rap, rapProvider, value, valueBasis, sources,
    ...(roli?.demand == null && utility?.demand != null ? { demandProvider: "routility" } : {}),
    ...(roli?.trend == null && utility?.trend != null ? { trendProvider: "routility" } : {}),
    ...(robloxBestPrice.price == null && utility?.bestPrice != null ? { bestPriceProvider: "routility" } : {}),
  };
}

function marketSample({ records, total, hasMore, ...metadata }, ref) {
  return { source: ref(metadata), ...(records ? { records, ...(hasMore ? { hasMore } : {}) } : {}) };
}

function addProofs(result, proofs, ref) {
  for (const row of result.records ?? []) {
    const post = proofs[row.postId] ??= { discordUrl: row.discordUrl };
    if (row.attachments && !post.nevos) {
      const { postedAt, content, attachments } = row;
      post.nevos = { postedAt, ...(content ? { content: content.slice(0, 1200) } : {}),
        ...(content?.length > 1200 ? { contentTruncated: true } : {}),
        ...(attachments.length ? { attachments } : {}) };
    }
    const review = row.reviewed ?? (row.baskets ? row : null);
    if (review && !post.reviewed) {
      const { postId, evidenceSha256, screenshots, ...reviewed } = review;
      post.reviewed = reviewed;
    }
    if (row.screenshots) post.screenshots = row.screenshots;
  }
  return {
    source: ref(result),
    ...(result.nevos ? { nevos: ref(result.nevos) } : {}),
    ...(result.records ? { postIds: result.records.map(({ postId }) => postId), hasMore: result.hasMore } : {}),
  };
}

function sideTotals(entries, items, robux, effectiveRobux) {
  const tally = (field) => {
    let total = 0;
    for (const { item, quantity, resolution } of entries) {
      const metric = items[item]?.[field];
      if (resolution || metric == null) return null;
      total += metric * quantity;
    }
    return Number.isSafeInteger(total) ? total : null;
  };
  const rap = tally("rap");
  const value = tally("value");
  const withRobux = (amount) => amount != null && effectiveRobux != null && Number.isSafeInteger(amount + effectiveRobux)
    ? amount + effectiveRobux : null;
  return { items: entries, robux, ...(robux !== effectiveRobux ? { effectiveRobux } : {}),
    itemRap: rap, itemValue: value, totalRap: withRobux(rap), totalValue: withRobux(value) };
}

export async function tradeContext(args, reviewed, readLiveProofs, proofOptions) {
  const { give, receive, tradeId, proofLimit, ownershipLimit } = args;
  const { sources, ref } = sourceIndex();
  const copyReads = new Map();
  async function lookUpCopy(copy) {
    const lookup = copy.uaid ? { uaid: copy.uaid } : { collectibleInstanceId: copy.collectibleInstanceId };
    const key = lookup.uaid ?? lookup.collectibleInstanceId;
    if (!copyReads.has(key)) copyReads.set(key, copyHistory({ ...lookup, page: 1, limit: ownershipLimit || 1 }));
    return copyReads.get(key);
  }

  const sides = [give, receive];
  const input = sides.flatMap((side) => side?.items ?? []);
  const resolved = await Promise.all(input.map((entry) => resolveItem(entry, lookUpCopy, ref, ownershipLimit)));
  const targetsByKey = new Map();
  const ownership = {};
  const uniqueCopies = new Set();
  for (const { entry, target, lookup } of resolved) {
    if (target) targetsByKey.set(entry.item, target);
    if (!entry.copy) continue;
    const ids = [entry.copy.uaid, entry.copy.collectibleInstanceId].filter(Boolean);
    if (ids.some((id) => uniqueCopies.has(id))) entry.resolution = "duplicate_copy";
    for (const id of ids) uniqueCopies.add(id);
    if (ownershipLimit && lookup?.status === "ok") {
      const key = ids[0];
      ownership[key] ??= compactOwnership(lookup, ownershipLimit, ref(lookup));
      entry.copy.history = key;
      delete entry.copySource;
    }
  }

  const proofs = {};
  const marketStats = itemStatsBatch([...targetsByKey.values()]);
  const items = Object.fromEntries(await Promise.all([...targetsByKey].map(async ([key, item], index) => {
    const page = 1;
    const [stats, sales, resale, changes, evidence] = await Promise.all([
      marketStats[index],
      history(item, { series: "rolimons_sales", page, limit: 3 }),
      history(item, { series: "roblox_resale", page, limit: 7 }),
      history(item, { series: "rolimons_value_changes", page, limit: 1 }),
      proofLimit ? tradeProofs(reviewed, item, { page, limit: proofLimit }, readLiveProofs, proofOptions) : null,
    ]);
    return [key, {
      ...itemSnapshot(stats, resale, ref),
      sales: marketSample(sales, ref),
      robloxResale: marketSample(resale, ref),
      valueChanges: marketSample(changes, ref),
      ...(evidence ? { proofs: addProofs(evidence, proofs, ref) } : {}),
    }];
  })));

  const entries = resolved.map(({ entry }) => entry);
  const haveOffers = Boolean(give && receive);
  const givenCount = give?.items.length ?? 0;
  const given = give ? sideTotals(entries.slice(0, givenCount), items, give.robux, give.robux) : null;
  const received = receive ? sideTotals(entries.slice(givenCount), items, receive.robux, Math.round(receive.robux * 0.7)) : null;
  const difference = (field) => haveOffers && given[field] != null && received[field] != null
    ? received[field] - given[field] : null;
  return {
    ...(tradeId ? { tradeId, tradeLookup: ref({ source: `https://trades.roblox.com/v2/trades/${tradeId}`,
      status: "unavailable", reason: "requires_authorized_roblox_session" }) } : {}),
    give: given, receive: received, nominalWL: { rap: difference("totalRap"), value: difference("totalValue") },
    items, ...(proofLimit ? { proofOrigin, proofs } : {}), ...(ownershipLimit ? { ownership } : {}), sources,
  };
}
