import market from "../../extension/background/public-market.js";
import targets from "../../extension/shared/market_targets.js";
import valuation from "../../extension/shared/trade-valuations.js";
import vendor from "../../extension/vendor/nevos/rolimons_item_details.js";

const { request, cached, remember, itemTTL } = market;
const { keyOf, idOf, rolimonsSalesUrl } = targets;
const rolimonsFeed = vendor.RolimonsItemDetails.ROLIMONS_ITEM_DETAILS_URL;
const utilityFeed = "https://routility.io/api/public/items";
const catalog = "https://catalog.roblox.com/v1/catalog/items/details";
const utilityCache = new Map();
const changeCache = new Map();
let nevosRetryAt = 0;

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

export async function findItems({ query, limit }) {
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
    const name = item.name.toLowerCase();
    const score = item.id === term || item.acronym?.toLowerCase() === term ? 0 :
      name === term ? 1 : name.startsWith(term) ? 2 : name.includes(term) ? 3 : Infinity;
    if (score < Infinity) matches.push({ item, score });
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

export async function itemStats(item) {
  const [feed, utility, [native], listing, dailySales] = await Promise.all([
    market.readItemFeed(), item.kind === "asset" ? readUtility() : null,
    market.readDetails([item]), market.readBestListing(item), market.readDailySales(item),
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
      ? unavailable(listing.source, listing.httpStatus)
      : { ...observed(listing.source, listing.checkedAt), price: listing.price },
  };
}

function readChanges(item, source) {
  return cached(changeCache, source) || remember(changeCache, source,
    request(source, {}, "text").then(({ data, status }) => {
      if (!data) return unavailable(source, status);
      const history = valuation.parseHistory(data, item, undefined, source, undefined, { allowEmpty: true });
      return history ? { ...observed(source, Date.now()), changes: history.changes } : unavailable(source, status);
    }).catch(() => unavailable(source)), 120, itemTTL);
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
  const segment = item.kind === "bundle" ? "bundle-value-changes" : "item-value-changes";
  const source = `https://www.rolimons.com/${segment}/${item.id}`;
  const { changes, ...metadata } = await readChanges(item, source);
  return { item, series, ...metadata, ...(changes ? pageOf(changes.toReversed().map(({ time, before, after }) => ({
    at: new Date(time).toISOString(), before, after,
  })), page, limit) : {}) };
}

export async function tradeObservations({ assetId, page }) {
  const source = `https://routility.io/web/item-trades/${assetId}?kind=trade&range=all&limit=20&page=${page}`;
  const data = await market.readTradeHistory(assetId, page);
  return { assetId, source, ...data, ...(data.status === "ok" ? {
    evidenceType: "ownership_transfer_observation", pageSize: 20,
    hasMore: data.page < data.pages, returnedTrades: data.trades.length,
  } : { page }) };
}

export async function tradeProofs(proofs, item, { page, limit }, nevosToken) {
  const nevosSource = `https://nevos-extension.com/api/proofs/search/${item.id}`;
  let nevos = { source: nevosSource, status: "unsupported" };
  if (item.kind === "asset") {
    nevos = unavailable(nevosSource);
    if (!nevosToken) nevos.reason = "no_nevos_client_token";
    else if (nevosRetryAt > Date.now()) {
      nevos.httpStatus = 429;
      nevos.reason = "rate_limited";
    } else {
      const signal = AbortSignal.timeout(20_000);
      try {
        const response = await fetch(nevosSource, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "X-NTE-Client": nevosToken,
            "From-Extension": "1",
            "Content-Type": "application/json",
          },
          redirect: "error",
          signal,
        });
        nevos.httpStatus = response.status;
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          const now = Date.now();
          const retryAt = /^\d+$/.test(retryAfter ?? "") ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter);
          nevosRetryAt = Number.isFinite(retryAt) ? Math.max(retryAt, now) : now + 60_000;
          nevos.reason = "rate_limited";
        } else if (!response.ok) {
          nevos.reason = "http_error";
        } else {
          const data = await response.json();
          if (data?.source?.trim?.() === "edge-cache" || !Array.isArray(data?.results) ||
              (data.item_id != null && data.item_id !== "" && idOf(data.item_id) !== item.id)) {
            nevos.reason = "invalid_proof_response";
          } else {
            const records = data.results.flatMap((row) => {
              if (typeof row?.id !== "string" || !/^\d{17,20}$/.test(row.id)) return [];
              const timestamp = Number(row.timestamp) || Number((BigInt(row.id) >> 22n) + 1420070400000n);
              return [{
                postId: row.id,
                postedAt: timestamp > 0 && timestamp < 8.64e15 ? new Date(timestamp).toISOString() : null,
                content: typeof row.content === "string" ? row.content : null,
                attachments: Array.isArray(row.attachments) ? row.attachments.filter((url) =>
                  typeof url === "string" && /^https:\/\/nevos-extension\.com\/api\/proofs\/images\/\d{5,32}$/.test(url)) : [],
              }];
            }).sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "") || b.postId.localeCompare(a.postId));
            if (data.results.length && !records.length) nevos.reason = "invalid_proof_response";
            else return { item, ...observed(nevosSource, Date.now()), evidenceType: "nevos_proof_post",
              providerCount: count(data.count), ...pageOf(records, page, limit) };
          }
        }
      } catch (error) {
        nevos.reason = signal.aborted || error.name === "TimeoutError" ? "timeout" :
          error instanceof SyntaxError ? "invalid_proof_response" : "request_failed";
      }
    }
  }

  const source = "https://discord.com/channels/415246288779608064/535250426061258753";
  if (!proofs) return { item, source, status: "unavailable", reason: "no_reviewed_public_proof_export_configured", nevos };
  const records = proofs.records.filter(({ baskets }) =>
    baskets.some((basket) => basket.some(({ kind, id }) => item.kind === kind && item.id === id)));
  return { item, ...observed(source, proofs.loadedAt), evidenceType: "reviewed_screenshot", nevos,
    ...pageOf(records, page, limit) };
}
