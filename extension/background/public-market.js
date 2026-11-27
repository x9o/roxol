const RoxolPublicMarket = (() => {
  const commonJS = typeof module !== "undefined" && module.exports;
  const targets = commonJS ? require("../shared/market_targets.js") : RoxolTargets;
  const salesCore = commonJS ? require("../vendor/nevos/nte_sales_core.js").NteSalesCore : NteSalesCore;
  const details = commonJS ? require("../vendor/nevos/rolimons_item_details.js").RolimonsItemDetails : RolimonsItemDetails;
  const rolimons = commonJS ? require("./rolimons.js") : RoxolRolimons;
  const { idOf, targetOf, keyOf, rolimonsSalesUrl, amount, copyIdOf } = targets;
  const detailsCache = new Map();
  const resaleCache = new Map();
  const itemFeedCache = new Map();
  const dailySalesCache = new Map();
  const salesCache = new Map();
  const tradeHistoryCache = new Map();
  const listingCache = new Map();
  const catalogUrl = "https://catalog.roblox.com/v1/catalog/items/details";
  const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const itemTTL = 5 * 60_000;
  const failureTTL = 20_000;
  const tradePageSize = 20;

  // Share public metadata across tabs and cap simultaneous requests.
  const requests = [];
  let activeRequests = 0;

  function dispatchRequests() {
    while (activeRequests < 4 && requests.length) {
      const next = requests.shift();
      activeRequests++;
      next.task().then(next.resolve, next.reject).finally(() => {
        activeRequests--;
        dispatchRequests();
      });
    }
  }

  function request(url, init = {}, format = "json") {
    if (requests.length >= 160) return Promise.reject(new Error("Market request queue is full"));
    return new Promise((resolve, reject) => {
      requests.push({
        resolve,
        reject,
        task: async () => {
          const timeout = AbortSignal.timeout(8000);
          const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
          const response = await fetch(url, {
            credentials: "omit",
            redirect: "error",
            ...init,
            signal,
          });
          const data = response.ok ? await response[format]() : null;
          return { status: response.status, data, csrf: response.headers.get("x-csrf-token") };
        },
      });
      dispatchRequests();
    });
  }

  function cached(cache, key) {
    const entry = cache.get(key);
    if (entry?.expires > Date.now()) return entry.result;
    cache.delete(key);
    return null;
  }

  function remember(cache, key, result, max, ttl) {
    const entry = { result, expires: Infinity };
    cache.set(key, entry);
    if (cache.size > max) cache.delete(cache.keys().next().value);
    result.then((value) => {
      const lifetime = typeof ttl === "function" ? ttl(value) : ttl;
      entry.expires = Date.now() + (value?.status === "unavailable" || value == null ? failureTTL : lifetime);
    }, () => {
      if (cache.get(key) === entry) cache.delete(key);
    });
    return result;
  }

  function readItemFeed() {
    const key = "itemdetails";
    return cached(itemFeedCache, key) || remember(itemFeedCache, key,
      request(details.ROLIMONS_ITEM_DETAILS_URL)
        .then(({ data }) => rolimons.itemIndex(data)).catch(() => null), 1, itemTTL);
  }

  function withItemMetadata(native, provider) {
    if (!provider) return native;
    return {
      ...native,
      status: "ok",
      name: provider.name,
      limited: true,
      rap: provider.rap ?? native?.rap ?? null,
      rapSource: provider.rap != null ? "Rolimon’s" : native?.rap != null ? "Roblox" : null,
      checkedAt: provider.rap != null ? provider.checkedAt : native?.checkedAt,
      rolimons: provider,
    };
  }

  function readTrackedSales(item) {
    const key = keyOf(item);
    return cached(salesCache, key) || remember(salesCache, key,
      request(rolimonsSalesUrl(item), {}, "text")
        .then(({ data }) => data ? rolimons.readSales(data) : { status: "unavailable" })
        .catch(() => ({ status: "unavailable" })), 60, itemTTL);
  }

  function readDailySales(item) {
    const key = keyOf(item);
    const url = details.profile_url(item.id, null, { isBundle: item.kind === "bundle" });
    return cached(dailySalesCache, key) || remember(dailySalesCache, key,
      request(url, {}, "text").then(({ data, status }) => ({
        average: data ? rolimons.readDailySales(data) : null,
        source: url,
        checkedAt: Date.now(),
        ...(status === 200 || status === 404 ? {} : { status: "unavailable", httpStatus: status }),
      })).catch(() => ({ status: "unavailable" })), 600, itemTTL);
  }

  function readBestListing(item) {
    const key = keyOf(item);
    const bundle = item.kind === "bundle";
    const url = bundle ? `https://catalog.roblox.com/v1/bundles/${item.id}/details`
      : `https://economy.roblox.com/v2/assets/${item.id}/details`;
    const lowestPrice = bundle ? salesCore.bundle_lowest_price : salesCore.asset_lowest_price;
    return cached(listingCache, key) || remember(listingCache, key,
      request(url).then(({ data, status }) => data
        ? { price: amount(lowestPrice(data)), source: url, checkedAt: Date.now() }
        : { status: "unavailable", httpStatus: status, source: url })
        .catch(() => ({ status: "unavailable" })), 240, 60_000);
  }

  async function catalogDetails(targets) {
    const items = targets.map(({ kind, id }) => ({
      itemType: kind === "bundle" ? "Bundle" : "Asset",
      id: Number.isSafeInteger(Number(id)) ? Number(id) : id,
    }));
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    };
    let reply = await request(catalogUrl, options);
    // Roblox may issue an anti-CSRF token for this cookie-free read endpoint.
    if (reply.status === 403 && reply.csrf) {
      reply = await request(catalogUrl, {
        ...options,
        headers: { ...options.headers, "X-CSRF-Token": reply.csrf },
      });
    }
    const results = new Map();
    for (const row of Array.isArray(reply.data?.data) ? reply.data.data : []) {
      const item = targetOf(String(row?.itemType).toLowerCase(), row?.id);
      if (!item) continue;
      const id = salesCore.asset_collectible_id(row) || salesCore.bundle_collectible_id(row);
      const restrictions = Array.isArray(row.itemRestrictions) ? row.itemRestrictions : [];
      const limited = restrictions.some((value) => /^(limited|limitedunique|collectible)$/i.test(value));
      results.set(keyOf(item), {
        status: "ok",
        name: typeof row.name === "string" ? row.name : null,
        collectibleId: uuidPattern.test(id || "") ? id : null,
        limited: limited || row.isLimited === true || row.isLimitedUnique === true,
        rap: amount(row.recentAveragePrice),
        assetType: amount(row.assetType),
        lowestAsk: amount(row.lowestResalePrice) || null,
        hasResellers: typeof row.hasResellers === "boolean" ? row.hasResellers :
          row.lowestResalePrice === 0 ? false : null,
        checkedAt: Date.now(),
      });
    }
    return results;
  }

  function readDetails(targets) {
    const missing = targets.filter((item) => !cached(detailsCache, keyOf(item)));
    if (missing.length) {
      const batch = catalogDetails(missing).catch(() => new Map());
      for (const item of missing) {
        const key = keyOf(item);
        remember(detailsCache, key, batch.then((results) => results.get(key) || null), 5000, itemTTL);
      }
    }
    return Promise.all(targets.map((item) => cached(detailsCache, keyOf(item))));
  }

  async function readOneResale(item) {
    const [detail] = await readDetails([item]);
    let collectibleId = detail?.collectibleId;
    if (!collectibleId && item.kind === "bundle") {
      const bundle = await request(`https://catalog.roblox.com/v1/bundles/${item.id}/details`);
      collectibleId = salesCore.bundle_collectible_id(bundle.data);
    }

    let payload = null;
    let source;
    let httpStatus;
    if (uuidPattern.test(collectibleId || "")) {
      source = `https://apis.roblox.com/marketplace-sales/v1/item/${collectibleId}/resale-data`;
      const result = await request(source).catch(() => null);
      payload = result?.data;
      httpStatus = result?.status;
    }

    const usedLegacyFallback = !payload && uuidPattern.test(collectibleId || "");
    if (!payload && item.kind === "asset") {
      source = `https://economy.roblox.com/v1/assets/${item.id}/resale-data`;
      const result = await request(source);
      payload = result.data;
      httpStatus = result.status;
    }
    if (!payload || typeof payload !== "object") return { status: "unavailable", source, httpStatus };

    const volumeByTime = salesCore.normalize_volume(payload);
    const daily = salesCore.normalize_points(payload, { preserveMissingVolume: true, volumeByTime })
      .filter((point) => Number.isSafeInteger(point.value) && Math.abs(point.time_ms) <= 8.64e15)
      .slice(0, 180);
    const hasVolume = Array.isArray(payload.volumeDataPoints) || Array.isArray(payload.resaleData?.volumeDataPoints);
    const volumeDays = hasVolume ? [...volumeByTime]
      .filter(([time]) => time > 0 && time <= 8.64e15)
      .sort(([a], [b]) => b - a).slice(0, 180) : null;
    const rap = amount(payload.recentAveragePrice ?? payload.resaleData?.recentAveragePrice);
    return { status: "ok", rap, daily, volumeDays, checkedAt: Date.now(), source, usedLegacyFallback };
  }

  function readResale(item) {
    const key = keyOf(item);
    return cached(resaleCache, key) || remember(resaleCache, key,
      readOneResale(item).catch(() => ({ status: "unavailable" })), 240,
      (data) => data.usedLegacyFallback ? failureTTL : itemTTL);
  }

  function observedAt(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 8.64e12) return null;
    return new Date(seconds * 1000).toISOString();
  }

  function tradeBasket(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      assetId: idOf(item?.asset_id),
      name: typeof item?.name === "string" ? item.name.trim() || null : null,
      userAssetId: idOf(item?.uaid),
      instanceId: copyIdOf(item?.ciid),
      serial: idOf(item?.serial),
      observedAt: observedAt(item?.ts),
      rap: amount(item?.rap),
      valueThen: amount(item?.value_then),
      quantity: item?.quantity === undefined ? 1 : amount(item.quantity) || null,
    }));
  }

  async function fetchTradeHistory(assetId, page, limit = tradePageSize) {
    const url = `https://routility.io/web/item-trades/${assetId}?kind=trade&range=all&limit=${limit}&page=${page}`;
    const { data, status } = await request(url);
    const pages = data?.total === 0 && data?.pages === 0 ? 1 : data?.pages;
    if (!Array.isArray(data?.trades) || amount(data.total) == null ||
        data.page !== page || !amount(pages) || data.page > pages ||
        data.per_page !== limit || data.trades.length > limit ||
        (page < pages && data.trades.length !== limit)) {
      return { status: "unavailable", httpStatus: status };
    }

    const trades = new Map();
    const records = data.trades.map((row) => {
      const id = row?.kind === "trade" && typeof row.trade_id === "string" && row.trade_id.trim()
        ? row.trade_id : null;
      const firstObservedAt = observedAt(row?.ts);
      const sideA = tradeBasket(row?.side_a_items);
      const sideB = tradeBasket(row?.side_b_items);
      const trade = {
        tradeId: typeof row?.trade_id === "string" ? row.trade_id : null,
        firstObservedAt,
        lastObservedAt: observedAt(row?.ts_latest),
        inferred: typeof row?.inferred === "boolean" ? row.inferred : null,
        sideA,
        sideB,
      };
      const invalidReason = !id ? "invalid-source-record" : !sideA.length || !sideB.length ? "missing-basket" :
        [...sideA, ...sideB].some((item) => item.assetId === assetId) ? null : "target-absent";
      if (invalidReason) {
        return { id, firstObservedAt, trade: null, invalidReason,
          rejectedTrade: { ...trade, kind: typeof row?.kind === "string" ? row.kind : null } };
      }
      trades.set(id, trade);
      return { id, firstObservedAt, trade };
    });
    return {
      status: "ok", page: data.page, pages, total: data.total,
      checkedAt: new Date().toISOString(), trades: [...trades.values()],
      ...(limit !== tradePageSize ? { records } : {}),
    };
  }

  function readTradeHistory(assetId, page) {
    const key = `${assetId}:${page}`;
    return cached(tradeHistoryCache, key) || remember(tradeHistoryCache, key,
      fetchTradeHistory(assetId, page).catch(() => ({ status: "unavailable" })), 60, 2 * 60_000);
  }

  return {
    request, cached, remember, itemTTL, failureTTL, catalogUrl, readItemFeed, withItemMetadata,
    readTrackedSales, readDailySales, readBestListing, readDetails, readResale, fetchTradeHistory, readTradeHistory,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RoxolPublicMarket;
