import market from "../../extension/background/public-market.js";
import targets from "../../extension/shared/market_targets.js";
import valuation from "../../extension/shared/trade-valuations.js";
import vendor from "../../extension/vendor/nevos/rolimons_item_details.js";
import { proofOrigin } from "./proofs.mjs";

const { request, cached, remember, itemTTL } = market;
const { keyOf, idOf, copyIdOf, rolimonsSalesUrl } = targets;
export const rolimonsFeed = vendor.RolimonsItemDetails.ROLIMONS_ITEM_DETAILS_URL;
const utilityFeed = "https://routility.io/api/public/items";
const catalog = "https://catalog.roblox.com/v1/catalog/items/details";
const utilityCache = new Map();
const changeCache = new Map();
const changeLogCache = new Map();
const copyHistoryCache = new Map();
const valueChangeLog = "https://www.rolimons.com/valuechanges";
let valueChangesRetryAt = 0;

const unavailable = (source, httpStatus) => ({ status: "unavailable", source, httpStatus });
const observed = (source, checkedAt) => ({ status: "ok", source, checkedAt: new Date(checkedAt).toISOString() });
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const number = (value) => Number.isFinite(value) && value >= 0 ? value : null;
const label = (value) => typeof value === "string" ? value.slice(0, 200) : null;
const flag = (value) => typeof value === "boolean" ? value : null;

function readUtility() {
  return cached(utilityCache, utilityFeed) || remember(utilityCache, utilityFeed,
    request(utilityFeed).then(({ data, status }) => {
      if (!Array.isArray(data?.items) || !data.items.length) return unavailable(utilityFeed, status);
      const items = new Map(data.items.flatMap((row) => {
        const id = idOf(row?.id);
        if (!id || typeof row.name !== "string") return [];
        return [[id, {
          name: label(row.name), acronym: label(row.acr), rap: count(row.rap), value: count(row.value),
          demand: label(row.demand), trend: label(row.trend), projected: flag(row.projected),
          hyped: flag(row.hyped), bestPrice: count(row.bestPrice), copies: count(row.copies),
          premiumCopies: count(row.premiumCopies), usdEstimate: number(row.usd),
          priceBasis: label(row.priceBasis),
        }]];
      }));
      return items.size ? { ...observed(utilityFeed, Date.now()), items } : unavailable(utilityFeed, status);
    }).catch(() => unavailable(utilityFeed)), 1, itemTTL);
}

function snapshot(source, row, feedAvailable, checkedAt) {
  if (!feedAvailable) return unavailable(source);
  if (!row) return { status: "not_found", source, checkedAt: checkedAt ?? null };
  return { ...observed(source, checkedAt ?? row.checkedAt), data: row };
}

export async function findItems({ query, limit, kind, exact = false }) {
  const [feed, utility] = await Promise.all([market.readItemFeed(), readUtility()]);
  const names = new Map();
  for (const [key, item] of feed ?? []) {
    const [kind, id] = key.split(":");
    names.set(key, { kind, id, name: item.name, acronym: item.acronym, provider: "Rolimon's" });
  }
  for (const [id, item] of utility.items ?? []) {
    const key = keyOf({ kind: "asset", id });
    if (!names.has(key)) names.set(key, { kind: "asset", id, name: item.name, acronym: item.acronym, provider: "RoUtility" });
  }
  const term = query.toLowerCase();
  const matches = [];
  for (const item of names.values()) {
    if (kind && item.kind !== kind) continue;
    const name = item.name.trim().toLowerCase();
    const score = item.id === term || item.acronym?.trim().toLowerCase() === term ? 0 :
      name === term ? 1 : name.startsWith(term) ? 2 : name.includes(term) ? 3 : Infinity;
    if (score <= (exact ? 1 : 3)) matches.push({ item, score });
  }
  matches.sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name));
  return {
    status: !feed && !utility.items ? "unavailable" : "ok",
    sources: {
      rolimons: { source: rolimonsFeed, status: feed ? "ok" : "unavailable",
        checkedAt: feed ? new Date(feed.values().next().value.checkedAt).toISOString() : null },
      routility: { source: utilityFeed, status: utility.status, checkedAt: utility.checkedAt ?? null },
    },
    total: matches.length, items: matches.slice(0, limit).map(({ item }) => item),
  };
}

export async function itemStats(item, detail = market.readDetails([item]).then(([row]) => row)) {
  const [feed, utility, native, listing, dailySales] = await Promise.all([
    market.readItemFeed(), item.kind === "asset" ? readUtility() : null,
    detail, market.readBestListing(item), market.readDailySales(item),
  ]);
  const row = feed?.get(keyOf(item));
  const utilityRow = utility?.items?.get(item.id);
  return {
    item,
    rolimons: snapshot(rolimonsFeed, row && {
      name: row.name, acronym: row.acronym, rap: row.rap, value: row.value, fallbackValue: row.fallbackValue,
      demand: row.demand, demandRating: row.demand ? row.demandRating : null,
      trend: row.trend, projected: row.projected, rare: row.rare, checkedAt: row.checkedAt,
    }, !!feed, feed ? new Date(feed.values().next().value.checkedAt).toISOString() : null),
    rolimonsDailySales: dailySales.source && dailySales.status !== "unavailable"
      ? { ...observed(dailySales.source, dailySales.checkedAt), average: dailySales.average }
      : unavailable(dailySales.source ?? vendor.RolimonsItemDetails.profile_url(item.id, null, { isBundle: item.kind === "bundle" }),
        dailySales.httpStatus),
    routility: utility?.status === "unavailable" ? unavailable(utilityFeed, utility.httpStatus)
      : utility ? snapshot(utilityFeed, utilityRow, true, utility.checkedAt)
        : { status: "unsupported", source: utilityFeed },
    roblox: snapshot(catalog, native && {
      name: native.name, rap: native.rap, collectibleId: native.collectibleId, limited: native.limited,
      checkedAt: native.checkedAt,
    }, !!native),
    robloxBestPrice: listing.status === "unavailable"
      ? unavailable(listing.source ?? (item.kind === "bundle" ? `https://catalog.roblox.com/v1/bundles/${item.id}/details`
        : `https://economy.roblox.com/v2/assets/${item.id}/details`), listing.httpStatus)
      : { ...observed(listing.source, listing.checkedAt), price: listing.price },
  };
}

export function itemStatsBatch(items) {
  const details = market.readDetails(items);
  return items.map((item, index) => itemStats(item, details.then((rows) => rows[index])));
}

function readChanges(cache, source, parse, cacheSize, successTTL = itemTTL) {
  const known = cached(cache, source);
  if (known) return known;
  const rateLimited = (httpStatus) => ({
    status: "rate_limited", source, httpStatus, retryAt: new Date(valueChangesRetryAt).toISOString(),
  });
  if (Date.now() < valueChangesRetryAt) return Promise.resolve(rateLimited());
  return remember(cache, source,
    request(source, {}, "text").then(({ data, status, retryAfter }) => {
      if (status === 429) {
        const now = Date.now();
        const deadline = /^\d+$/.test(retryAfter ?? "") ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter);
        const retryAt = Number.isFinite(deadline) && deadline <= 8.64e15 ? Math.max(now + 1000, deadline) : now + 60_000;
        valueChangesRetryAt = Math.max(valueChangesRetryAt, retryAt);
        return rateLimited(status);
      }
      if (status !== 200) return unavailable(source, status);
      const history = parse(data);
      return history ? { ...observed(source, Date.now()), ...history } :
        { ...unavailable(source, status), reason: "invalid_history" };
    }).catch(() => unavailable(source)), cacheSize, (result) => result.status === "rate_limited" ? 0 : successTTL);
}

function parseChangeLog(html) {
  const match = /\bvar value_changes\s*=\s*(\[[^;]*\]);/.exec(html);
  if (!match) return null;
  let rows;
  try {
    rows = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!rows.length) return null;
  const changesByItem = new Map();
  let oldest = Infinity;
  let newest = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 6) return null;
    const [seconds, rawId, type, field, before, after] = row;
    const time = valuation.timestamp(seconds);
    const id = idOf(rawId);
    if (!time || !id || (type !== 1 && type !== 2) || !Number.isInteger(field)) return null;
    oldest = Math.min(oldest, time);
    newest = Math.max(newest, time);
    if (field !== 1) continue;
    if (![before, after].every((value) => value === null || targets.amount(value) > 0)) return null;
    const key = keyOf({ kind: type === 2 ? "bundle" : "asset", id });
    if (!changesByItem.has(key)) changesByItem.set(key, []);
    changesByItem.get(key).push({ time, before, after });
  }
  if (!changesByItem.size) return null;
  for (const changes of changesByItem.values()) changes.sort((a, b) => a.time - b.time);
  return { oldest, newest, changesByItem };
}

export function readValueChangeLog() {
  return readChanges(changeLogCache, valueChangeLog, parseChangeLog, 1, 60_000);
}

function pageOf(rows, page, limit) {
  const offset = (page - 1) * limit;
  return { page, limit, total: rows.length, hasMore: offset + limit < rows.length, records: rows.slice(offset, offset + limit) };
}

export async function history(item, { series, page, limit }) {
  if (series === "rolimons_sales") {
    const source = rolimonsSalesUrl(item);
    const data = await market.readTrackedSales(item);
    return { item, series, ...(data.status === "ok" ? {
      ...observed(source, data.checkedAt), providerTrackedCount: data.count,
      ...pageOf(data.sales.map(({ time, ...sale }) => ({ ...sale, at: new Date(time).toISOString() })), page, limit),
    } : unavailable(source)) };
  }
  if (series === "roblox_resale") {
    const data = await market.readResale(item);
    const source = data.source ?? (item.kind === "asset"
      ? `https://economy.roblox.com/v1/assets/${item.id}/resale-data` : catalog);
    return { item, series, ...(data.status === "ok" ? {
      ...observed(source, data.checkedAt), rap: data.rap, coverageLimit: 180,
      ...pageOf(data.daily.map(({ time_ms, value, volume }) => ({
        at: new Date(time_ms).toISOString(), price: value, volume: volume ?? null,
      })), page, limit),
    } : unavailable(source, data.httpStatus)) };
  }
  const { changes, ...metadata } = await readValueChanges(item);
  return { item, series, ...metadata, ...(changes ? pageOf(changes.toReversed().map(({ time, before, after }) => ({
    at: new Date(time).toISOString(), before, after,
  })), page, limit) : {}) };
}

export function readValueChanges(item) {
  const segment = item.kind === "bundle" ? "bundle-value-changes" : "item-value-changes";
  const source = `https://www.rolimons.com/${segment}/${item.id}`;
  return readChanges(changeCache, source,
    (html) => valuation.parseHistory(html, item, undefined, source, undefined, { allowEmpty: true }), 120);
}

export async function tradeObservations({ assetId, page }) {
  const source = `https://routility.io/web/item-trades/${assetId}?kind=trade&range=all&limit=20&page=${page}`;
  const data = await market.readTradeHistory(assetId, page);
  return { assetId, source, ...data, ...(data.status === "ok" ? {
    evidenceType: "ownership_transfer_observation", pageSize: 20,
    hasMore: data.page < data.pages, returnedTrades: data.trades.length,
  } : { page }) };
}

function copyOwner(row) {
  const seconds = row?.ts_sec;
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 8.64e12) return null;
  const ownerId = idOf(row.player_id);
  const username = label(row.player_name);
  return {
    at: new Date(seconds * 1000).toISOString(),
    ...(ownerId ? { ownerId } : {}),
    ...(username ? { username } : {}),
    ...(row.is_hidden === true || (!ownerId && !username) ? { hidden: true } : {}),
    ...(row._prev === true ? { previousOwner: true } : {}),
  };
}

async function readCopyHistory(source, lookup) {
  const { data, status } = await request(source);
  if (status === 404) return { status: "not_found", source };

  const uaid = idOf(data?.uaid);
  const assetId = idOf(data?.item_id);
  const instanceId = copyIdOf(data?.ciid);
  const collectibleInstanceId = instanceId && !idOf(instanceId) ? instanceId : null;
  if (!assetId || (lookup.uaid && uaid !== lookup.uaid) ||
      (lookup.collectibleInstanceId && collectibleInstanceId !== lookup.collectibleInstanceId) ||
      !Array.isArray(data?.owners)) return unavailable(source, status);

  const records = data.owners.toSorted((a, b) => b?.ts_sec - a?.ts_sec).map(copyOwner);
  const currentOwner = data.current_owner == null ? null : copyOwner(data.current_owner);
  if (records.includes(null) || (data.current_owner != null && !currentOwner)) return unavailable(source, status);

  return {
    ...observed(source, Date.now()),
    copy: {
      ...(uaid ? { uaid } : {}),
      ...(collectibleInstanceId ? { collectibleInstanceId } : {}),
      assetId,
      name: label(data.item_name),
      serial: idOf(data.serial),
    },
    ...(currentOwner ? { currentOwner } : {}),
    records,
  };
}

export async function copyHistory({ uaid, collectibleInstanceId, page, limit }) {
  const lookup = uaid ? { uaid } : { collectibleInstanceId };
  const source = `https://routility.io/web/${uaid ? `uaid/${uaid}` : `ciiid/${collectibleInstanceId}`}`;
  const { records, ...metadata } = await (cached(copyHistoryCache, source) || remember(copyHistoryCache, source,
    readCopyHistory(source, lookup).catch(() => unavailable(source)), 120, 2 * 60_000));
  return records ? { ...metadata, ...pageOf(records, page, limit) } : { ...metadata, copy: lookup };
}

function pageOfProofs(records, page, limit) {
  const unique = new Map();
  for (const record of records) {
    if (!unique.has(record.postId)) unique.set(record.postId, record);
  }
  return pageOf(Array.from(unique.values()), page, limit);
}

export async function tradeProofs(proofs, item, { page, limit, readScreenshots, screenshotOffset = 0, inferKind, itemName, itemAcronym }, readLiveProofs,
  { readAliases, screenshots } = {}) {
  const needsAliases = inferKind || item.kind === "bundle" || proofs?.records.length || screenshots?.byItem.size;
  let aliases = needsAliases ? await readAliases?.() : null;
  if (inferKind) {
    const assetKey = keyOf(item);
    const bundle = { id: item.id, kind: "bundle" };
    const bundleKey = keyOf(bundle);
    if (!aliases?.has(assetKey) && !screenshots?.byItem.has(assetKey) &&
        (aliases?.has(bundleKey) || screenshots?.byItem.has(bundleKey))) {
      item = bundle;
    }
  }
  let equivalents = aliases?.get(keyOf(item)) ?? [];
  const primary = item.kind === "bundle" && equivalents.length === 1 ? equivalents[0] : item;
  const lookup = (target) => readLiveProofs(target, target === item ? { itemName, itemAcronym } : {});
  let discord = await lookup(primary);
  if (!discord.records?.length && (discord.status === "ok" || discord.reason === "no_item_search_terms")) {
    if (!needsAliases) {
      aliases = await readAliases?.();
      equivalents = aliases?.get(keyOf(item)) ?? [];
    }
    const bundle = item.kind === "bundle" && equivalents.length ? item :
      equivalents.find(({ kind }) => kind === "bundle");
    if (bundle && bundle !== primary) {
      const fallback = await lookup(bundle);
      if (fallback.records?.length || discord.status !== "ok" && fallback.status === "ok") discord = fallback;
    }
  }
  const keys = [item, ...equivalents].map(keyOf);
  const reviewed = keys.flatMap((key) => proofs?.byItem.get(key) ?? [])
    .sort((a, b) => b.completedAtReported.localeCompare(a.completedAtReported) || b.postId.localeCompare(a.postId));
  const indexed = new Map();
  for (const record of keys.flatMap((key) => screenshots?.byItem.get(key) ?? [])) {
    indexed.set(record.postId, { postId: record.postId, postedAt: record.postedAt });
  }
  const recentFirst = (a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "") || b.postId.localeCompare(a.postId);

  const { records: liveRecords = [], count: providerCount, ...provider } = discord;
  let result;
  if (liveRecords.length || discord.status === "ok" && !reviewed.length && !indexed.size) {
    const posts = new Map();
    for (const record of reviewed) {
      if (!posts.has(record.postId)) posts.set(record.postId, { postedAt: record.completedAtReported, ...record });
    }
    for (const record of indexed.values()) {
      if (!posts.has(record.postId)) posts.set(record.postId, record);
    }
    for (const record of liveRecords) {
      if (posts.get(record.postId)?.attachments) continue;
      const reviewed = posts.get(record.postId);
      posts.set(record.postId, { ...record, ...(reviewed?.baskets ? { reviewed } : {}) });
    }
    result = { item, ...observed(discord.source, Date.parse(discord.checkedAt) || Date.now()), evidenceType: "discord_proof_post",
      providerCount: count(providerCount), ...pageOfProofs([...posts.values()].sort(recentFirst), page, limit) };
  } else {
    const source = proofOrigin.url;
    if (!proofs && !indexed.size) {
      return { item, source, proofOrigin, status: "unavailable", reason: discord.reason, discord: provider,
        ...(provider.partial ? { partial: true } : {}) };
    }
    const reviewedPosts = new Set(reviewed.map(({ postId }) => postId));
    const records = [...reviewed, ...[...indexed.values()].filter(({ postId }) => !reviewedPosts.has(postId))]
      .sort((a, b) => recentFirst({ ...a, postedAt: a.completedAtReported ?? a.postedAt },
        { ...b, postedAt: b.completedAtReported ?? b.postedAt }));
    result = { item, ...observed(source, proofs?.loadedAt ?? Date.now()),
      evidenceType: reviewed.length || !indexed.size ? "reviewed_screenshot" : "indexed_screenshot",
      ...pageOfProofs(records, page, limit) };
  }

  let position = 0;
  result.records = await Promise.all(result.records.map(async (record) => {
    const stored = screenshots?.forPost(record.postId) ?? [];
    const known = new Set(stored.map(({ attachment }) => attachment));
    const attachments = [...new Set(record.attachments)];
    const start = position;
    position += attachments.length;
    const selected = readScreenshots && screenshots ? attachments.filter((attachment, offset) =>
      start + offset >= screenshotOffset && start + offset < screenshotOffset + 12 && !known.has(attachment)) : [];
    const unprocessed = attachments.some((attachment) => !known.has(attachment) && !selected.includes(attachment));
    const evidence = [...stored, ...await Promise.all(selected.map((attachment) => screenshots.read(record, attachment)))];
    return { ...record, discordUrl: `${proofOrigin.url}/${record.postId}`, ...(evidence.length ? { screenshots: evidence } : {}),
      ...(readScreenshots && unprocessed ? { moreScreenshots: true } : {}) };
  }));
  return { ...result, proofOrigin, discord: provider, ...(provider.partial ? { partial: true } : {}) };
}
