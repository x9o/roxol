const RoxolTradeHistory = (() => {
  const ui = RoxolMarketUI;
  const { element, tradingFigure: figure, tradingStat: stat } = ui;
  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  });

  const itemName = (item) => item.name || (item.assetId ? `Asset ${item.assetId}` : "Unknown item");
  const amount = (value) => value == null ? "—" : ui.format(value);

  function basketTotal(items, prices) {
    let total = 0;
    for (const item of items) {
      const value = prices[item.assetId]?.value;
      if (value == null || !item.quantity) return null;
      total += value * item.quantity;
      if (!Number.isSafeInteger(total)) return null;
    }
    return total || null;
  }

  function basket(items, assetId, label, total, prices, { historyCards, historyStats }) {
    const side = element("div", "roxol-trade-basket");
    const heading = element("h3", "roxol-basket-heading");
    heading.append(element("span", "", label));
    if (historyStats) heading.append(element("strong", "roxol-number", amount(total)));
    const list = element("ul", "roxol-basket-items");
    for (const item of items) {
      const row = element("li", "roxol-basket-item");
      if (historyCards) {
        const thumb = element("span", "roxol-basket-thumbnail");
        if (item.assetId) thumb.dataset.assetId = item.assetId;
        row.append(thumb);
      }
      const title = element("div", "roxol-basket-name");
      const name = itemName(item);
      if (item.assetId === assetId) {
        title.append(element("strong", "", name));
      } else if (item.assetId) {
        title.append(ui.link(name, RoxolTargets.robloxItemUrl({ kind: "asset", id: item.assetId }), true));
      } else {
        title.append(element("span", "", name));
      }
      if (item.quantity > 1) title.append(element("span", "roxol-history-note", ` ×${ui.format(item.quantity)}`));
      row.append(title);
      if (historyStats) {
        const price = prices[item.assetId];
        const value = element("div", "roxol-basket-value roxol-number", amount(price?.value));
        value.append(element("small", "roxol-history-note", price?.method === "assigned-value" ? "Value" : price ? "RAP" : "Unpriced"));
        row.append(value);
      }
      list.append(row);
    }
    side.append(heading, list);
    return side;
  }

  function valuationTable(items, label) {
    const table = element("table", "roxol-table roxol-valuation-table");
    const head = table.createTHead().insertRow();
    for (const text of ["Item", "RAP", "Value"]) {
      const column = element("th", "", text);
      column.scope = "col";
      head.append(column);
    }
    table.createCaption().textContent = label;
    const body = table.createTBody();
    for (const item of items) {
      const row = body.insertRow();
      const name = row.insertCell();
      name.textContent = itemName(item);
      const metadata = [];
      if (item.serial) metadata.push(`#${item.serial}`);
      if (item.quantity !== 1) metadata.push(item.quantity == null ? "Quantity unknown" : `×${ui.format(item.quantity)}`);
      if (item.observedAt) metadata.push(`${dateFormat.format(new Date(item.observedAt))} UTC`);
      if (metadata.length) name.append(element("small", "roxol-history-note", metadata.join(" · ")));
      row.insertCell().textContent = amount(item.rap);
      row.insertCell().textContent = amount(item.valueThen);
    }
    return table;
  }

  function tradeRecord(trade, assetId, prices, preferences) {
    const article = element("article", "roxol-history-record");
    const caption = element("div", "roxol-history-caption");
    if (trade.lastObservedAt || trade.firstObservedAt) {
      const observed = trade.lastObservedAt || trade.firstObservedAt;
      const time = element("time", "", `${dateFormat.format(new Date(observed))} UTC`);
      time.dateTime = observed;
      caption.append(time);
    } else {
      caption.append(element("span", "", "Observation time unavailable"));
    }
    const totalA = preferences.historyStats ? basketTotal(trade.sideA, prices) : null;
    const totalB = preferences.historyStats ? basketTotal(trade.sideB, prices) : null;
    if (trade.inferred) caption.append(element("span", "", "Inferred"));
    const sides = element("div", "roxol-basket-pair");
    sides.append(basket(trade.sideA, assetId, "Side A", totalA, prices, preferences),
      basket(trade.sideB, assetId, "Side B", totalB, prices, preferences));
    article.append(caption, sides);
    if (!preferences.historyStats) return article;

    const op = totalA == null || totalB == null ? null : totalB - totalA;
    if (op == null) caption.append(element("span", "", "Unpriced trade"));
    else if (Math.max(totalA, totalB) / Math.min(totalA, totalB) > 2) {
      caption.append(element("span", "", "Severe imbalance"));
    }
    const comparison = element("dl", "roxol-stat-grid roxol-history-comparison");
    comparison.append(stat("OP (B − A)", figure(op)), stat("OP % of A", figure(op == null ? null : op / totalA, true)));
    const details = element("details", "roxol-disclosure roxol-history-details");
    const tables = element("div", "roxol-history-tables");
    tables.append(valuationTable(trade.sideA, "Side A · RoUtility observations"),
      valuationTable(trade.sideB, "Side B · RoUtility observations"));
    details.append(element("summary", "", "Valuation details"), tables);
    article.append(comparison, details);
    return article;
  }

  async function loadThumbnails(records, assetId) {
    const slots = [...records.querySelectorAll(".roxol-basket-thumbnail[data-asset-id]")];
    const ids = [...new Set(slots.map((slot) => slot.dataset.assetId))];
    for (let index = 0; index < ids.length && records.isConnected; index += 100) {
      const batch = ids.slice(index, index + 100);
      const { images } = await ui.request("thumbnails", { assetId, ids: batch }) ?? {};
      if (!images) continue;
      for (const slot of slots) {
        const url = images[slot.dataset.assetId];
        if (!url || !slot.isConnected) continue;
        const image = element("img");
        image.alt = "";
        image.loading = "lazy";
        image.addEventListener("error", () => image.remove(), { once: true });
        image.src = url;
        slot.append(image);
      }
    }
  }

  function download(assetId, sourceUrl, visited) {
    const trades = new Map();
    const pages = [...visited.values()].sort((a, b) => a.page - b.page).map((result) => {
      for (const trade of result.trades) trades.set(trade.tradeId, trade);
      return { page: result.page, checkedAt: result.checkedAt, sourceTotal: result.total, sourcePages: result.pages };
    });
    const report = {
      source: "RoUtility", sourceUrl, assetId, range: "all", pages, exportedAt: new Date().toISOString(),
      trades: [...trades.values()],
    };
    ui.downloadJson(`roxol-trades-${assetId}.json`, report);
  }

  function open(assetId, name, sourceUrl, preferences) {
    const body = ui.showDialog(name ? `Trade history · ${name}` : "Trade history");
    const dialog = body.parentElement;
    dialog.classList.add("roxol-trade-history");
    const source = ui.link("View on RoUtility", sourceUrl, true);
    const exportButton = ui.button("Export viewed trades");
    exportButton.disabled = true;
    exportButton.title = "Download JSON for the pages viewed in this dialog";
    const actions = element("div", "roxol-history-actions");
    actions.append(source, exportButton);
    const note = element("p", "roxol-history-note",
      "Totals use current Rolimon’s Value per copy, or current Rolimon’s RAP when there’s no positive Value. OP compares Side B against Side A. Side payments are unknown.");
    const previous = ui.button("Previous");
    const next = ui.button("Next");
    const retry = ui.button("Try again");
    const status = element("span", "roxol-history-status roxol-loading-status");
    status.setAttribute("role", "status");
    const nav = element("nav", "roxol-history-nav");
    nav.setAttribute("aria-label", "Trade history pages");
    nav.append(previous, status, next, retry);
    const records = element("div", "roxol-history-records");
    body.append(actions, note, nav, records);

    const visited = new Map();
    let current;
    let requestedPage;

    function pageStatus(result) {
      if (!result.total) return "No tracked trades.";
      const label = `Page ${ui.format(result.page)} of ${ui.format(result.pages)} · ${ui.format(result.total)} tracked`;
      return preferences.historyStats && result.pricingUnavailable && result.trades.length
        ? `${label} · Rolimon’s prices unavailable` : label;
    }

    function paint() {
      dialog.classList.toggle("roxol-history-compact", !preferences.historyCards);
      dialog.classList.toggle("roxol-history-without-stats", !preferences.historyStats);
      note.hidden = !preferences.historyStats;
      if (!current) return;
      records.replaceChildren(...current.trades.map((trade) => tradeRecord(trade, assetId, current.prices, preferences)));
      if (preferences.historyCards) void loadThumbnails(records, assetId);
      if (current.total && !current.trades.length) {
        records.append(element("p", "roxol-history-note", "No two-sided trade records on this page."));
      }
    }

    async function load(page) {
      requestedPage = page;
      previous.disabled = next.disabled = retry.hidden = true;
      status.textContent = `Loading page ${ui.format(page)}…`;
      status.setAttribute("data-loading", "");
      records.setAttribute("aria-busy", "true");
      const result = await ui.request("trade-history", { assetId, page });
      if (!dialog.open || !dialog.isConnected) return;
      records.removeAttribute("aria-busy");
      status.removeAttribute("data-loading");
      if (result?.status !== "ok") {
        status.textContent = current
          ? `Page ${ui.format(page)} unavailable. Showing page ${ui.format(current.page)}.`
          : "RoUtility trade history is unavailable.";
        retry.hidden = false;
      } else {
        current = result;
        visited.set(result.page, result);
        exportButton.disabled = ![...visited.values()].some((entry) => entry.trades.length);
        status.textContent = pageStatus(result);
        retry.hidden = !(preferences.historyStats && result.pricingUnavailable && result.trades.length);
        paint();
      }
      previous.disabled = !current || current.page <= 1;
      next.disabled = !current || current.page >= current.pages;
    }

    previous.addEventListener("click", () => { void load(current.page - 1); });
    next.addEventListener("click", () => { void load(current.page + 1); });
    retry.addEventListener("click", () => { void load(requestedPage); });
    exportButton.addEventListener("click", () => download(assetId, sourceUrl, visited));
    paint();
    void load(1);
    return (next) => {
      if (!dialog.open || !dialog.isConnected) return;
      preferences = next;
      if (current && !status.hasAttribute("data-loading") && requestedPage === current.page) {
        status.textContent = pageStatus(current);
        retry.hidden = !(preferences.historyStats && current.pricingUnavailable && current.trades.length);
      }
      paint();
    };
  }

  return { open };
})();
