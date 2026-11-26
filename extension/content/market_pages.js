(() => {
  const { routeOf, keyOf } = RoxolTargets;
  const ui = RoxolMarketUI;
  const cardSelector = ".item-card-container, .catalog-item-container, [data-testid='item-card'], .item-card";
  const detailSelector = "#item-details, #item-container, #item-details-container, .item-details, .item-details-section, [data-testid='item-details']";
  const detailTitleSelector = ".item-details-name-row h1, .item-name-container h1";
  const detailPriceSelector = ".text-robux-lg, .text-robux, [data-testid='item-price'], [data-testid='best-price'], [data-testid='best-price-amount']";
  const priceRowSelector = ".item-info-row-container, [data-testid='best-price-row'], tr";
  const profileSelector = "#profile-header-container, .profile-header-container, #profile-header, .profile-header, [data-testid='profile-header']";
  const mainSelector = "main, #content";
  const limitedSelector = ".limited-icon-container, .icon-label-limited, .icon-label-limited-unique, [title='Limited'], [title='Limited U']";
  const mobile = matchMedia("(max-width: 767px)");
  const cardStates = new Map();
  const panels = new Set();
  let pendingCards = new Set();
  let batchTimer;
  let scanTimer;
  let currentPage;
  let pathname;
  let preferences;
  let itemOptions;

  function itemTarget(anchor) {
    const route = routeOf(anchor.href);
    return route?.page === "detail" ? { kind: route.kind, id: route.id } : null;
  }

  function nativeItemAnchor(card) {
    const wrapper = card.closest("a[href]");
    const anchors = wrapper ? [wrapper] : card.querySelectorAll("a[href]");
    for (const anchor of anchors) {
      if (!anchor.closest(".roxol-market") && itemTarget(anchor)) return anchor;
    }
    return null;
  }

  function cardItem(card) {
    const anchor = nativeItemAnchor(card);
    if (anchor) return itemTarget(anchor);
    return RoxolTargets.cardTarget(card);
  }

  function discardCard(card, state) {
    visibleCards.unobserve(card);
    pendingCards.delete(state);
    state.widget?.remove();
    cardStates.delete(card);
  }

  function resetPage() {
    ui.closeDialog();
    visibleCards.disconnect();
    for (const state of cardStates.values()) state.widget?.remove();
    cardStates.clear();
    pendingCards.clear();
    for (const panel of panels) panel.remove();
    panels.clear();
    currentPage = routeOf(location.href);
    pathname = location.pathname;
  }

  function enqueueCard(state) {
    pendingCards.add(state);
    if (!batchTimer) batchTimer = setTimeout(loadVisibleCards, 80);
  }

  const visibleCards = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      visibleCards.unobserve(entry.target);
      const state = cardStates.get(entry.target);
      if (state) enqueueCard(state);
    }
  }, { rootMargin: "160px" });

  function mountCard(state) {
    const { card, item, data } = state;
    if (!data?.limited && !card.querySelector(limitedSelector)) return;
    const copy = RoxolTargets.cardCopy(card);
    const { instanceId, userAssetId, serial } = copy;
    state.copy = JSON.stringify(copy);
    state.widget = ui.mountCard(card, { ...item, ...data, limited: true, copyId: instanceId || userAssetId, serial },
      { ...itemOptions, priceIsRap: currentPage.page !== "catalog" });
  }

  async function loadVisibleCards() {
    batchTimer = null;
    const group = [...pendingCards].slice(0, 40);
    for (const state of group) pendingCards.delete(state);
    if (pendingCards.size) batchTimer = setTimeout(loadVisibleCards, 80);
    if (!group.length) return;

    const details = await ui.request("items", { items: group.map((state) => state.item) });
    for (const state of group) {
      const { card, item, key } = state;
      if (cardStates.get(card) !== state || !card.isConnected || pathname !== location.pathname) continue;
      const liveItem = cardItem(card);
      if (!liveItem || keyOf(liveItem) !== key) continue;
      state.data = details?.[key] ?? null;
      mountCard(state);
    }
  }

  function scanCards() {
    for (const [card, state] of cardStates) {
      const item = card.isConnected && cardItem(card);
      if (!item || keyOf(item) !== state.key) {
        discardCard(card, state);
      } else if (state.data !== undefined &&
          (!state.widget?.valid() || state.copy !== JSON.stringify(RoxolTargets.cardCopy(card)))) {
        state.widget?.remove();
        mountCard(state);
      }
    }

    for (const candidate of document.querySelectorAll(cardSelector)) {
      if (candidate.closest(".roxol-market")) continue;
      const anchor = nativeItemAnchor(candidate);
      const card = anchor ? (anchor.closest(cardSelector) || anchor.querySelector(cardSelector)) : candidate;
      if (candidate !== card || cardStates.has(card)) continue;
      const item = cardItem(card);
      if (!item) continue;
      cardStates.set(card, { card, item, key: keyOf(item) });
      visibleCards.observe(card);
    }
  }

  function mountTitleLink(page, title, label, url, beside = false) {
    if (!title) return;
    if (!page.titleLink) {
      page.titleLink = ui.titleLink(label, url);
      panels.add(page.titleLink);
    }
    if (beside) {
      page.titleLink.classList.add("roxol-profile-title-link");
      if (page.titleLink.previousElementSibling !== title) title.after(page.titleLink);
    } else {
      page.titleLink.classList.remove("roxol-profile-title-link");
      if (page.titleLink.parentElement !== title) {
        const tradesLink = page.tradesLink?.parentElement === title ? page.tradesLink : null;
        title.insertBefore(page.titleLink, tradesLink);
      }
    }
  }

  async function loadDetail(page) {
    const key = keyOf(page);
    const details = await ui.request("items", { items: [page] });
    if (currentPage !== page || pathname !== location.pathname) return;
    const data = details?.[key];
    const detail = document.querySelector(detailSelector) || document.querySelector(mainSelector);
    const limited = data?.limited || !!detail?.querySelector(limitedSelector);

    let resale;
    if (!limited && (itemOptions.showValue || itemOptions.sales) && (!data || data.collectibleId)) {
      resale = await ui.request("resale", { item: page });
    }
    if (currentPage !== page || pathname !== location.pathname) return;
    page.detailData = { data, resale, limited, rap: data?.rap ?? resale?.rap };
    mountDetail(page);
  }

  function readBestPrice(detail) {
    if (!detail) return null;
    const read = (node) => {
      const text = node.textContent.trim();
      if (!/^\d+(?:[,.'’\s]\d{3})*$/.test(text)) return null;
      const price = Number(text.replace(/\D/g, ""));
      return Number.isSafeInteger(price) && price > 0 ? { node, price } : null;
    };
    for (const node of detail.querySelectorAll("[data-testid='best-price-amount'], [data-testid='best-price']")) {
      const amount = read(node);
      if (amount) return amount;
    }
    for (const label of detail.querySelectorAll(".row-label, div, span, dt, label, p")) {
      if (!/^best price\s*:?$/i.test(label.textContent.trim())) continue;
      const row = label.closest(priceRowSelector);
      const boundary = row || label.closest(".price-row-container, .price-container-text");
      let container = label.parentElement;
      for (let depth = 0; container && container !== detail && depth < 3; depth++, container = container.parentElement) {
        for (const selector of [detailPriceSelector, "span, dd", "div"]) {
          for (const node of container.querySelectorAll(selector)) {
            if (node.closest(priceRowSelector) !== row) continue;
            const amount = read(node);
            if (amount) return amount;
          }
        }
        if (container === boundary) break;
      }
    }
    return null;
  }

  function mountBestPriceDeals(page, detail) {
    const main = document.querySelector(mainSelector);
    const best = readBestPrice(detail) || (main !== detail && readBestPrice(main)) || null;
    const { data, rap } = page.detailData;
    if (page.bestPrice !== best?.price || page.dealRap !== rap) {
      page.deals?.remove();
      panels.delete(page.deals);
      page.bestPrice = best?.price;
      page.dealRap = rap;
      page.deals = best && ui.bestPriceDeals(best.price, rap, data?.rolimons?.value);
      if (page.deals) panels.add(page.deals);
    }
    if (page.deals && page.deals.previousElementSibling !== best.node) best.node.after(page.deals);
  }

  function mountDetail(page) {
    const detail = document.querySelector(".item-details-section") || document.querySelector(detailSelector);
    const limited = page.detailData?.limited || !!detail?.querySelector(limitedSelector);
    const itemTitle = document.querySelector(detailTitleSelector) ||
      (detail?.querySelector(".price-row-container, .price-container-text, [data-testid='item-price']")
        ? detail.querySelector("h1") : null);
    const title = itemTitle || detail?.querySelector("h1");
    if (itemTitle && page.kind === "asset" && limited) {
      if (!page.tradesLink) {
        const link = ui.link("View trades", `https://routility.io/catalog/${page.id}/trades`, true);
        link.className = "roxol-view-trades";
        link.setAttribute("aria-haspopup", "dialog");
        link.addEventListener("click", (event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          const name = [...link.parentElement.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent).join("").trim();
          page.updateHistory = RoxolTradeHistory.open(page.id, name, link.href, preferences);
        });
        page.tradesLink = link;
        panels.add(link);
      }
      if (page.tradesLink.parentElement !== itemTitle) itemTitle.append(page.tradesLink);
    } else {
      page.tradesLink?.remove();
    }
    const anchor = detail?.querySelector(".price-row-container, .price-container-text")
      || document.querySelector(".price-row-container, .price-container-text")
      || detail?.querySelector("[data-testid='item-price']") || title?.parentElement;
    if (!anchor) return;
    if (!page.detailData) {
      page.detailRequest ??= loadDetail(page);
      return;
    }
    const showInsights = itemOptions.showValue || itemOptions.indicators || itemOptions.sales;
    const { data, resale, rap } = page.detailData;
    if (!page.panel && showInsights && (limited || resale?.rap != null || resale?.daily?.length)) {
      page.panel = ui.itemPanel({
        kind: page.kind, id: page.id, ...data, limited: true,
        rap,
        checkedAt: resale?.checkedAt ?? data?.checkedAt,
      }, {
        ...itemOptions,
        getBestPrice: () => page.bestPrice,
        onRap(rap) {
          if (currentPage !== page || pathname !== location.pathname) return;
          page.detailData.rap = rap;
          scheduleScan();
        },
      });
      panels.add(page.panel);
    }
    if (!limited && !page.panel) return;
    if (itemOptions.showValue) mountBestPriceDeals(page, detail);
    const valueAnchor = page.deals?.previousElementSibling === anchor ? page.deals : anchor;
    if (page.panel && page.panel.previousElementSibling !== valueAnchor) valueAnchor.after(page.panel);
    if (preferences.itemOverpay && !page.overpayPanel && page.kind === "asset" && limited) {
      page.overpayPanel = RoxolOverpay.mount(page.id);
      panels.add(page.overpayPanel);
    }
    const overpayAnchor = page.panel || valueAnchor;
    if (page.overpayPanel && page.overpayPanel.previousElementSibling !== overpayAnchor) {
      overpayAnchor.after(page.overpayPanel);
    }
    mountTitleLink(page, title, "View item on Rolimon’s", ui.rolimonsItemUrl(page));
  }

  function profileModel() {
    const model = {
      items: [], copies: new Set(), cursors: new Set(),
      cursor: "", loading: false, failed: false, private: false, partial: false,
      pages: 0, totalRap: 0n, rapCount: 0, totalValue: 0n, valueCount: 0, fallbackCount: 0,
      canLoad() {
        return !this.private && (!this.pages || !!this.cursor);
      },
      summary(isValue) {
        const label = isValue ? "Value" : "RAP";
        const total = isValue ? this.totalValue : this.totalRap;
        const priced = isValue ? this.valueCount : this.rapCount;
        const known = priced || (this.pages && !this.items.length && !this.canLoad() && !this.partial);
        const text = known ? `${ui.format(total)} ${label}` : `${label} ${this.loading ? "…" : "unavailable"}`;
        const coverage = priced < this.items.length ? ` ${label} available for ${priced} of ${this.items.length} loaded copies.` : "";
        const source = priced ? (isValue ? " Value from Rolimon’s." : " RAP from Rolimon’s where available, otherwise Roblox.") : "";
        const fallback = isValue && this.fallbackCount ? ` ${this.fallbackCount} ${this.fallbackCount === 1 ? "copy uses" : "copies use"} Rolimon’s fallback value.` : "";
        return { text, description: coverage + source + fallback };
      },
      description() {
        if (this.private) return "Roblox reports that this inventory is private.";
        if (this.loading && !this.items.length) return "Loading collectible assets…";
        if (this.failed && !this.items.length) return "Roblox inventory is unavailable. Try again.";
        if (this.failed) return `${this.items.length} copies loaded. Further results are unavailable.`;
        if (this.canLoad() || this.partial) return `${this.items.length} copies loaded · partial inventory.`;
        if (!this.items.length) return "No collectible assets returned by Roblox.";
        return `${this.items.length} collectible asset ${this.items.length === 1 ? "copy" : "copies"} · Roblox.`;
      },
      accept(page) {
        this.failed = page?.status !== "ok" && page?.status !== "private";
        this.private = page?.status === "private";
        if (page?.status !== "ok") return;
        this.pages++;
        for (const item of page.items) {
          if (item.copyId && this.copies.has(item.copyId)) continue;
          if (item.copyId) this.copies.add(item.copyId);
          this.items.push(item);
          if (item.rap != null) {
            this.totalRap += BigInt(item.rap);
            this.rapCount++;
          }
          const { value, fallbackValue } = item.rolimons ?? {};
          const pricedValue = value ?? fallbackValue;
          if (pricedValue != null) {
            this.totalValue += BigInt(pricedValue);
            this.valueCount++;
            if (value == null) this.fallbackCount++;
          }
        }
        const repeated = !!page.next && this.cursors.has(page.next);
        this.partial ||= page.partial || repeated;
        this.cursor = repeated ? "" : page.next;
        if (this.cursor) this.cursors.add(this.cursor);
      },
    };
    return model;
  }

  function makeProfilePanel(page) {
    const panel = ui.element("div", "roxol-market roxol-profile");
    const badges = ui.element("div", "roxol-player-badges");
    badges.hidden = true;
    const rap = ui.button("");
    const value = ui.button("");
    for (const pill of [rap, value]) {
      pill.className = "roxol-profile-pill";
      pill.setAttribute("aria-haspopup", "dialog");
    }
    const trade = ui.link("Trade Items", `https://www.roblox.com/users/${page.id}/trade`);
    trade.className = "roxol-profile-pill roxol-trade-shortcut";
    trade.hidden = true;
    panel.append(rap, value, trade);

    const model = profileModel();
    let paintDialog;

    function paint() {
      for (const pill of [rap, value]) {
        const summary = model.summary(pill === value);
        pill.textContent = summary.text;
        pill.title = "Open inventory breakdown. " + model.description() + summary.description;
      }
      paintDialog?.();
    }

    async function loadPage() {
      if (model.loading || !model.canLoad()) return;
      model.loading = true;
      paint();
      const response = await ui.request("inventory", { cursor: model.cursor, profileId: page.id });
      if (currentPage !== page || pathname !== location.pathname || page.panel !== panel) return;
      model.loading = false;
      model.accept(response);
      paint();
    }

    function openBreakdown() {
      paintDialog = ui.inventoryView(model, loadPage, badges, itemOptions);
    }
    rap.addEventListener("click", openBreakdown);
    value.addEventListener("click", openBreakdown);

    page.trade = trade;
    void loadPage();
    if (page.page === "profile") {
      void ui.request("badges", { profileId: page.id }).then((result) => {
        if (currentPage === page && page.panel === panel && pathname === location.pathname) {
          ui.showPlayerBadges(badges, page.id, result);
        }
      });
    }
    return panel;
  }

  function updateTradeShortcut(page) {
    if (!page.trade || page.page !== "profile") return;
    const nativeTrade = () => !!document.querySelector(
      `#profile-trade-items, [data-testid='trade-items'], a[href$='/users/${page.id}/trade']:not(.roxol-trade-shortcut)`,
    );
    const show = mobile.matches && !nativeTrade();
    page.trade.hidden = !show || !page.tradeEligible;
    if (!show || page.tradeChecked) return;

    page.tradeChecked = true;
    void ui.request("eligibility", { profileId: page.id }).then((result) => {
      if (currentPage !== page || pathname !== location.pathname) return;
      page.tradeEligible = result?.eligible === true;
      page.trade.hidden = !page.tradeEligible || !mobile.matches || nativeTrade();
    });
  }

  function mountProfile(page) {
    const header = document.querySelector(".user-profile-header") || document.querySelector(profileSelector);
    const social = header?.querySelector(":scope > .gap-small.flex, .profile-header-social, [data-testid='profile-social-counts']");
    const host = social || header || (page.page === "inventory" && document.querySelector(mainSelector));
    if (!host) return;
    if (!page.panel) {
      page.panel = makeProfilePanel(page);
      panels.add(page.panel);
    }
    page.panel.classList.toggle("roxol-profile-native", !!social);
    if (page.panel.parentElement !== host) {
      if (page.page === "inventory" && !header) host.prepend(page.panel);
      else host.append(page.panel);
    }
    const nativeName = header?.querySelector("#profile-header-title-container-name");
    const title = nativeName || header?.querySelector(".profile-display-name, .profile-name, [data-testid='profile-display-name'], h1");
    mountTitleLink(page, title, "View player on Rolimon’s", `https://www.rolimons.com/player/${page.id}`, !!nativeName);
    updateTradeShortcut(page);
  }

  function scan() {
    scanTimer = null;
    if (!preferences?.enabled) return;
    if (pathname !== location.pathname) resetPage();
    if (!currentPage) return;
    if (currentPage.page === "detail") mountDetail(currentPage);
    if (currentPage.page === "profile" || currentPage.page === "inventory") mountProfile(currentPage);
    if (itemOptions.showValue || itemOptions.indicators || itemOptions.sales) scanCards();
  }

  function scheduleScan() {
    if (!scanTimer) scanTimer = setTimeout(scan, 100);
  }

  mobile.addEventListener("change", scheduleScan);
  window.addEventListener("popstate", scheduleScan);
  window.navigation?.addEventListener("currententrychange", scheduleScan);
  new MutationObserver((changes) => {
    if (changes.some(({ target }) => !(target.nodeType === Node.TEXT_NODE ? target.parentElement : target)?.closest(".roxol-market"))) {
      scheduleScan();
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["href", "data-collectibleiteminstanceid", "data-collectible-item-instance-id",
      "data-user-asset-id", "data-userassetid", "user-asset-id", "data-serial-number", "data-serialnumber"] });
  RoxolPreferences.watch((next) => {
    const changed = (key) => next[key] !== preferences?.[key];
    const reset = changed("enabled") || ["itemValue", "itemIndicators", "itemSales"].some(changed);
    const overpayChanged = changed("itemOverpay") && currentPage?.page === "detail";
    if (changed("historyCards") || changed("historyStats")) currentPage?.updateHistory?.(next);
    preferences = next;
    itemOptions = {
      showValue: next.itemValue, indicators: next.itemIndicators, sales: next.itemSales, projected: next.itemIndicators,
    };
    if (reset) {
      resetPage();
      scheduleScan();
    } else if (overpayChanged) {
      if (!next.itemOverpay && currentPage.overpayPanel) {
        currentPage.overpayPanel.remove();
        panels.delete(currentPage.overpayPanel);
        currentPage.overpayPanel = null;
      }
      scheduleScan();
    }
  });
})();
