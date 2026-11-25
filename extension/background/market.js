(() => {
  const { idOf, targetOf, routeOf, keyOf, rolimonsSalesUrl, amount, copyIdOf } = RoxolTargets;
  const detailsCache = new Map();
  const resaleCache = new Map();
  const inventoryCache = new Map();
  const itemFeedCache = new Map();
  const salesCache = new Map();
  const tradeHistoryCache = new Map();
  const listingCache = new Map();
  const playerCache = new Map();
  const catalogUrl = "https://catalog.roblox.com/v1/catalog/items/details";
  const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const itemTTL = 5 * 60_000;
  const failureTTL = 20_000;

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
          const response = await fetch(url, {
            credentials: "omit",
            redirect: "error",
            ...init,
            signal: AbortSignal.timeout(8000),
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
      entry.expires = Date.now() + (value?.status === "unavailable" || value == null ? failureTTL : ttl);
    }, () => {
      if (cache.get(key) === entry) cache.delete(key);
    });
    return result;
  }

  function readItemFeed() {
    const key = "itemdetails";
    return cached(itemFeedCache, key) || remember(itemFeedCache, key,
      request(RolimonsItemDetails.ROLIMONS_ITEM_DETAILS_URL)
        .then(({ data }) => RoxolRolimons.itemIndex(data)).catch(() => null), 1, itemTTL);
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
        .then(({ data }) => data ? RoxolRolimons.readSales(data) : { status: "unavailable" })
        .catch(() => ({ status: "unavailable" })), 60, itemTTL);
  }

  function readBestListing(item) {
    const key = keyOf(item);
    const bundle = item.kind === "bundle";
    const url = bundle ? `https://catalog.roblox.com/v1/bundles/${item.id}/details`
      : `https://economy.roblox.com/v2/assets/${item.id}/details`;
    const lowestPrice = bundle ? NteSalesCore.bundle_lowest_price : NteSalesCore.asset_lowest_price;
    return cached(listingCache, key) || remember(listingCache, key,
      request(url).then(({ data }) => data
        ? { price: amount(lowestPrice(data)) }
        : { status: "unavailable" })
        .catch(() => ({ status: "unavailable" })), 240, 60_000);
  }

  function readPlayerBadges(id) {
    return cached(playerCache, id) || remember(playerCache, id,
      request(`https://api.rolimons.com/players/v1/playerinfo/${id}`).then(({ data }) => {
        if (data?.success !== true) return { status: "unavailable" };
        const badges = Object.keys(data.rolibadges ?? {}).filter((key) => /^[a-z0-9_]+$/.test(key));
        return { status: "ok", badges };
      }).catch(() => ({ status: "unavailable" })), 100, 15 * 60_000);
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
      const id = NteSalesCore.asset_collectible_id(row) || NteSalesCore.bundle_collectible_id(row);
      const restrictions = Array.isArray(row.itemRestrictions) ? row.itemRestrictions : [];
      const limited = restrictions.some((value) => /^(limited|limitedunique|collectible)$/i.test(value));
      results.set(keyOf(item), {
        status: "ok",
        name: typeof row.name === "string" ? row.name : null,
        collectibleId: uuidPattern.test(id || "") ? id : null,
        limited: limited || row.isLimited === true || row.isLimitedUnique === true,
        rap: amount(row.recentAveragePrice),
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
        remember(detailsCache, key, batch.then((results) => results.get(key) || null), 600, itemTTL);
      }
    }
    return Promise.all(targets.map((item) => cached(detailsCache, keyOf(item))));
  }

  async function readOneResale(item) {
    const [detail] = await readDetails([item]);
    let collectibleId = detail?.collectibleId;
    if (!collectibleId && item.kind === "bundle") {
      const bundle = await request(`https://catalog.roblox.com/v1/bundles/${item.id}/details`);
      collectibleId = NteSalesCore.bundle_collectible_id(bundle.data);
    }

    let payload = null;
    if (uuidPattern.test(collectibleId || "")) {
      const result = await request(`https://apis.roblox.com/marketplace-sales/v1/item/${collectibleId}/resale-data`)
        .catch(() => null);
      payload = result?.data;
    }

    if (!payload && item.kind === "asset") {
      const result = await request(`https://economy.roblox.com/v1/assets/${item.id}/resale-data`);
      payload = result.data;
    }
    if (!payload || typeof payload !== "object") return { status: "unavailable" };

    const daily = NteSalesCore.normalize_points(payload)
      .filter((point) => Number.isSafeInteger(point.value) && Math.abs(point.time_ms) <= 8.64e15)
      .slice(0, 180);
    const rap = amount(payload.recentAveragePrice ?? payload.resaleData?.recentAveragePrice);
    return { status: "ok", rap, daily, checkedAt: Date.now() };
  }

  function readResale(item) {
    const key = keyOf(item);
    return cached(resaleCache, key) || remember(resaleCache, key,
      readOneResale(item).catch(() => ({ status: "unavailable" })), 240, itemTTL);
  }

  function normalizeCopy(row) {
    const target = targetOf("asset", row?.assetId);
    if (!target) return null;
    return {
      ...target,
      copyId: idOf(row.userAssetId),
      name: typeof row.name === "string" && row.name.trim() ? row.name : `Asset ${target.id}`,
      rap: amount(row.recentAveragePrice),
      serial: idOf(row.serialNumber),
    };
  }

  async function readInventoryPage(id, cursor) {
    const base = `https://inventory.roblox.com/v1/users/${id}`;
    const params = new URLSearchParams({ limit: "100", sortOrder: "Asc" });
    if (cursor) params.set("cursor", cursor);
    const { status, data } = await request(`${base}/assets/collectibles?${params}`);
    if (status === 403 && !cursor) {
      const visibility = await request(`${base}/can-view-inventory`).catch(() => null);
      if (visibility?.data?.canView === false) return { status: "private" };
    }
    if (!Array.isArray(data?.data)) return { status: "unavailable" };
    const items = data.data.map(normalizeCopy).filter(Boolean);
    const next = typeof data.nextPageCursor === "string" ? data.nextPageCursor : "";
    const partial = items.length < data.data.length || next.length > 2048 || (next && next === cursor);
    return { status: "ok", items, next: next && next !== cursor && next.length <= 2048 ? next : "", partial: Boolean(partial), checkedAt: Date.now() };
  }

  function readInventory(id, cursor) {
    const key = JSON.stringify([id, cursor]);
    return cached(inventoryCache, key) || remember(inventoryCache, key,
      readInventoryPage(id, cursor).catch(() => ({ status: "unavailable" })), 60, 60_000);
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

  async function fetchTradeHistory(assetId, page) {
    const url = `https://routility.io/web/item-trades/${assetId}?kind=trade&range=all&limit=20&page=${page}`;
    const { data } = await request(url);
    if (!Array.isArray(data?.trades) || amount(data.total) == null ||
        !amount(data.page) || !amount(data.pages) || data.page > data.pages) {
      return { status: "unavailable" };
    }

    const trades = new Map();
    for (const row of data.trades) {
      if (row?.kind !== "trade" || typeof row.trade_id !== "string" || !row.trade_id.trim()) continue;
      const sideA = tradeBasket(row.side_a_items);
      const sideB = tradeBasket(row.side_b_items);
      if (!sideA.length || !sideB.length || ![...sideA, ...sideB].some((item) => item.assetId === assetId)) continue;
      trades.set(row.trade_id, {
        tradeId: row.trade_id,
        firstObservedAt: observedAt(row.ts),
        lastObservedAt: observedAt(row.ts_latest),
        inferred: typeof row.inferred === "boolean" ? row.inferred : null,
        sideA,
        sideB,
      });
    }
    return {
      status: "ok", page: data.page, pages: data.pages, total: data.total,
      checkedAt: new Date().toISOString(), trades: [...trades.values()],
    };
  }

  function readTradeHistory(assetId, page) {
    const key = `${assetId}:${page}`;
    return cached(tradeHistoryCache, key) || remember(tradeHistoryCache, key,
      fetchTradeHistory(assetId, page), 60, 2 * 60_000);
  }

  async function eligibility(id) {
    const { data } = await request(`https://trades.roblox.com/v2/users/${id}/can-trade-with`, {
      credentials: "include",
      cache: "no-store",
    });
    const viewer = idOf(data?.userId);
    return { eligible: data?.canTrade === true && idOf(data?.targetUserId) === id && !!viewer && viewer !== id };
  }

  const handlers = {
    async "roxol:market-items"(message) {
      const targets = new Map();
      for (const input of Array.isArray(message.items) ? message.items.slice(0, 40) : []) {
        const item = targetOf(input?.kind, input?.id);
        if (item) targets.set(keyOf(item), item);
      }
      const entries = [...targets.values()];
      if (!entries.length) return {};
      const feed = await readItemFeed();
      const needsRoblox = entries.filter((item) => feed?.get(keyOf(item))?.rap == null);
      const details = await readDetails(needsRoblox);
      const native = new Map(needsRoblox.map((item, index) => [keyOf(item), details[index]]));
      return Object.fromEntries(entries.map((item) => {
        const key = keyOf(item);
        return [key, withItemMetadata(native.get(key) ?? null, feed?.get(key))];
      }));
    },
    "roxol:market-resale"(message) {
      const item = targetOf(message.item?.kind, message.item?.id);
      return item ? readResale(item) : { status: "unavailable" };
    },
    "roxol:market-sales"(message) {
      const item = targetOf(message.item?.kind, message.item?.id);
      return item ? readTrackedSales(item) : { status: "unavailable" };
    },
    "roxol:market-trade-history"(message, route) {
      if (route.page !== "detail" || route.kind !== "asset" || message.assetId !== route.id ||
          !amount(message.page)) return { status: "unavailable" };
      return readTradeHistory(route.id, message.page);
    },
    "roxol:market-best-listing"(message) {
      const item = targetOf(message.item?.kind, message.item?.id);
      return item ? readBestListing(item) : { status: "unavailable" };
    },
    async "roxol:market-inventory"(message, route) {
      if (route.page !== "profile" && route.page !== "inventory") return { status: "unavailable" };
      if (message.profileId !== route.id) return { status: "unavailable" };
      const cursor = message.cursor ?? "";
      if (typeof cursor !== "string" || cursor.length > 2048) return { status: "unavailable" };
      const [page, feed] = await Promise.all([readInventory(route.id, cursor), readItemFeed()]);
      if (page.status !== "ok") return page;
      const items = page.items.map((item) => withItemMetadata(
        { ...item, limited: true, checkedAt: page.checkedAt }, feed?.get(keyOf(item)),
      ));
      return { ...page, items };
    },
    "roxol:market-eligibility"(message, route) {
      return route.page === "profile" && message.profileId === route.id ? eligibility(route.id) : { eligible: false };
    },
    "roxol:market-badges"(message, route) {
      return route.page === "profile" && message.profileId === route.id
        ? readPlayerBadges(route.id) : { status: "unavailable" };
    },
  };

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || typeof sender.url !== "string") return;
    const route = routeOf(sender.url);
    if (!route || !Object.hasOwn(handlers, message?.type)) return;
    Promise.resolve().then(() => handlers[message.type](message, route))
      .then(reply, () => reply({ status: "unavailable" }));
    return true;
  });
})();
