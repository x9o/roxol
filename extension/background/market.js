(() => {
  const { idOf, targetOf, routeOf, keyOf, amount, copyIdOf } = RoxolTargets;
  const {
    request, cached, remember, itemTTL, failureTTL, readItemFeed, withItemMetadata,
    readTrackedSales, readDailySales, readBestListing, readDetails, readResale, readTradeHistory,
  } = RoxolPublicMarket;
  const inventoryCache = new Map();
  const playerCache = new Map();
  const proofCache = new Map();
  let proofRetryAt = 0;
  const proofTokenKey = "nevosProofToken";

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, proofTokenKey)) {
      proofCache.clear();
      proofRetryAt = 0;
    }
  });

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

  async function fetchOverpay(assetId, listingName) {
    const { [proofTokenKey]: token } = await chrome.storage.local.get(proofTokenKey);
    if (!token) return { status: "unavailable", reason: "token-required" };
    if (Date.now() < proofRetryAt) return { status: "unavailable", reason: "rate-limited" };
    const search = (term) => request(`https://nevos-extension.com/api/proofs/search/${encodeURIComponent(term)}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "From-Extension": "1", "X-NTE-Client": token },
    });
    let result = await search(assetId);
    if (listingName && (result.status === 404 || result.status === 200 && !result.data?.results?.length &&
        !result.data?.item_id && !result.data?.item_name && !result.data?.acronym)) {
      result = await search(listingName);
    }
    const { status, data, retryAfter } = result;
    if (status === 429) {
      const delay = /^\d+$/.test(retryAfter ?? "") ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter);
      proofRetryAt = Number.isFinite(delay) ? delay : Date.now() + 60_000;
      return { status: "unavailable", reason: "rate-limited" };
    }
    if (status === 401 || status === 403) return { status: "unavailable", reason: "access-denied" };
    if (status === 404) return RoxolProofOverpay.summarize({ results: [] }, {});
    if (status !== 200 || data?.source?.trim?.() === "edge-cache" || !Array.isArray(data?.results) ||
        (data.item_id && idOf(data.item_id) !== assetId)) return { status: "unavailable" };
    const key = keyOf(targetOf("asset", assetId));
    return RoxolProofOverpay.summarize(data, { key, name: listingName }, data.results.length ? await readItemFeed() : null);
  }

  function readOverpay(assetId, listingName) {
    return cached(proofCache, assetId) || remember(proofCache, assetId,
      fetchOverpay(assetId, listingName).catch(() => ({ status: "unavailable" })), 48, 2 * 60_000);
  }

  async function readProofImage(url) {
    const unavailable = { status: "unavailable" };
    const { [proofTokenKey]: token } = await chrome.storage.local.get(proofTokenKey);
    if (!token) return unavailable;
    const response = await fetch(url, {
      headers: { Accept: "image/*", "From-Extension": "1", "X-NTE-Client": token },
      credentials: "omit", redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.body) return unavailable;

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 5 * 1024 * 1024) return unavailable;
        chunks.push(value);
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    const text = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
    const mime = bytes[0] === 0x89 && text(1, 8) === "PNG\r\n\x1a\n" ? "image/png"
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
        : text(0, 4) === "RIFF" && text(8, 12) === "WEBP" ? "image/webp"
          : ["GIF87a", "GIF89a"].includes(text(0, 6)) ? "image/gif" : null;
    if (!mime) return unavailable;
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) parts.push(text(offset, offset + 8192));
    return { status: "ok", src: `data:${mime};base64,${btoa(parts.join(""))}` };
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
      const listingName = typeof message.listingName === "string" ? message.listingName.trim().slice(0, 160) : "";
      return readOverpay(route.id, listingName);
    },
    "roxol:market-proof-image"(message, route) {
      if (route.page !== "detail" || route.kind !== "asset" || !RoxolProofOverpay.isAttachment(message.url)) {
        return { status: "unavailable" };
      }
      return readProofImage(message.url);
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
