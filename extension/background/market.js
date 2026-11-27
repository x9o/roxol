(() => {
  const { idOf, targetOf, routeOf, keyOf, amount, copyIdOf } = RoxolTargets;
  const {
    request, cached, remember, itemTTL, failureTTL, readItemFeed, withItemMetadata,
    readTrackedSales, readDailySales, readBestListing, readDetails, readResale, fetchTradeHistory, readTradeHistory,
  } = RoxolPublicMarket;
  const inventoryCache = new Map();
  const overpayCache = new Map();
  const playerCache = new Map();
  const overpayStorageKey = "overpay-samples-v1";
  const overpayTTL = 2 * 60_000;
  let saveSamples = Promise.resolve();

  function readPlayerBadges(id) {
    return cached(playerCache, id) || remember(playerCache, id,
      request(`https://api.rolimons.com/players/v1/playerinfo/${id}`).then(({ data }) => {
        if (data?.success !== true) return { status: "unavailable" };
        const badges = Object.keys(data.rolibadges ?? {}).filter((key) => /^[a-z0-9_]+$/.test(key));
        return { status: "ok", badges };
      }).catch(() => ({ status: "unavailable" })), 100, 15 * 60_000);
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

  async function readThumbnails(inputs) {
    const ids = new Set(inputs.slice(0, 100).map(idOf).filter(Boolean));
    if (!ids.size) return { images: {} };
    // Thumbnail loading is separate from the market request queue.
    const response = await fetch(
      `https://thumbnails.roblox.com/v1/assets?assetIds=${[...ids].join(",")}&size=150x150&format=Png&isCircular=false`,
      { credentials: "omit", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return { status: "unavailable" };
    const { data } = await response.json();
    const images = Object.fromEntries((data ?? []).flatMap(({ targetId, state, imageUrl }) => {
      const id = idOf(targetId);
      return state === "Completed" && ids.has(id) && /^https:\/\/[\w-]+\.rbxcdn\.com\//i.test(imageUrl)
        ? [[id, imageUrl]] : [];
    }));
    return { images };
  }

  async function fetchOverpay(assetId) {
    const feed = readItemFeed();
    const { [overpayStorageKey]: entries = [] } = await chrome.storage.local.get(overpayStorageKey).catch(() => ({}));
    const previous = entries.find((entry) => entry.assetId === assetId);
    const now = Date.now();
    if (previous?.checkedAt + overpayTTL > now) {
      return RoxolOverpaySampling.summarizeSample({ ...previous, now, feed: await feed });
    }

    const { saved, ...result } = await RoxolOverpaySampling.sampleItem({
      assetId, previous, now, feed,
      readPage: (page, limit) => fetchTradeHistory(assetId, page, limit),
    });
    if (saved) {
      saveSamples = saveSamples.then(async () => {
        const { [overpayStorageKey]: stored = [] } = await chrome.storage.local.get(overpayStorageKey);
        const updated = [saved, ...stored.filter((entry) => entry.assetId !== assetId)];
        await chrome.storage.local.set({ [overpayStorageKey]: updated.slice(0, 12) });
      }).catch(() => {});
      await saveSamples;
    }
    return result;
  }

  function readOverpay(assetId) {
    return cached(overpayCache, assetId) || remember(overpayCache, assetId, fetchOverpay(assetId), 12,
      (result) => result.partial || result.pricedAt == null ? failureTTL :
        Math.max(0, Math.min(result.checkedAt + overpayTTL, result.pricedAt + itemTTL) - Date.now()));
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
    async "roxol:market-daily-sales"(message) {
      const item = targetOf(message.item?.kind, message.item?.id);
      if (!item) return { status: "unavailable" };
      const feed = await readItemFeed();
      return feed && !feed.get(keyOf(item))?.demand ? readDailySales(item) : { status: "unavailable" };
    },
    async "roxol:market-trade-history"(message, route) {
      if (route.page !== "detail" || route.kind !== "asset" || message.assetId !== route.id ||
          !amount(message.page)) return { status: "unavailable" };
      const [history, feed] = await Promise.all([readTradeHistory(route.id, message.page), readItemFeed()]);
      if (history.status !== "ok") return history;
      const ids = new Set(history.trades.flatMap(({ sideA, sideB }) => [...sideA, ...sideB].map(({ assetId }) => assetId)));
      const prices = Object.fromEntries([...ids].map((id) => [id, RoxolItemOverpay.currentPrice(feed, id)]));
      return { ...history, prices, pricingUnavailable: !feed };
    },
    "roxol:market-thumbnails"(message, route) {
      if (route.page !== "detail" || route.kind !== "asset" || message.assetId !== route.id ||
          !Array.isArray(message.ids)) return { status: "unavailable" };
      return readThumbnails(message.ids);
    },
    "roxol:market-overpay"(message, route) {
      if (route.page !== "detail" || route.kind !== "asset" || message.assetId !== route.id) {
        return { status: "unavailable" };
      }
      return readOverpay(route.id);
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
