const RoxolTradeHistory = (() => {
  const ui = RoxolMarketUI;
  const { element } = ui;
  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  });

  function basket(items, assetId, label) {
    const side = element("div", "roxol-history-side");
    const list = element("ul", "roxol-history-items");
    for (const item of items) {
      const row = element("li");
      const name = item.name || (item.assetId ? `Asset ${item.assetId}` : "Unknown item");
      if (item.assetId === assetId) {
        row.append(element("strong", "roxol-history-target", name));
      } else if (item.assetId) {
        row.append(ui.link(name, RoxolTargets.robloxItemUrl({ kind: "asset", id: item.assetId }), true));
      } else {
        row.append(element("span", "", name));
      }
      if (item.serial) row.append(element("span", "roxol-history-note", ` #${item.serial}`));
      if (item.quantity > 1) row.append(element("span", "roxol-history-note", ` ×${ui.format(item.quantity)}`));
      row.append(element("div", "roxol-history-note roxol-history-metrics",
        `RAP ${item.rap == null ? "—" : ui.format(item.rap)} · Value ${item.valueThen > 0 ? ui.format(item.valueThen) : "—"}`));
      list.append(row);
    }
    side.append(element("h3", "roxol-history-side-label", label), list);
    return side;
  }

  function tradeCard(trade, assetId) {
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
    if (trade.inferred) caption.append(element("span", "roxol-history-inferred", "Inferred"));
    const sides = element("div", "roxol-history-sides");
    sides.append(basket(trade.sideA, assetId, "Side A"), basket(trade.sideB, assetId, "Side B"));
    article.append(caption, sides);
    return article;
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
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + "\n"], { type: "application/json" }));
    const link = element("a");
    link.href = url;
    link.download = `roxol-trades-${assetId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function open(assetId, name, sourceUrl) {
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
      "RAP and Value are reported by RoUtility at its observation times. Side payments are unknown. A dash marks an unavailable figure.");
    const previous = ui.button("Previous");
    const next = ui.button("Next");
    const retry = ui.button("Try again");
    const status = element("span", "roxol-history-status");
    status.setAttribute("role", "status");
    const nav = element("nav", "roxol-history-nav");
    nav.setAttribute("aria-label", "Trade history pages");
    nav.append(previous, status, next, retry);
    const records = element("div", "roxol-history-records");
    body.append(actions, note, nav, records);

    const visited = new Map();
    let current;
    let requestedPage;

    async function load(page) {
      requestedPage = page;
      previous.disabled = next.disabled = retry.hidden = true;
      status.textContent = `Loading page ${ui.format(page)}…`;
      records.setAttribute("aria-busy", "true");
      const result = await ui.request("trade-history", { assetId, page });
      if (!dialog.open || !dialog.isConnected) return;
      records.removeAttribute("aria-busy");
      if (result?.status !== "ok") {
        status.textContent = current
          ? `Page ${ui.format(page)} unavailable. Showing page ${ui.format(current.page)}.`
          : "RoUtility trade history is unavailable.";
        retry.hidden = false;
      } else {
        current = result;
        visited.set(result.page, result);
        exportButton.disabled = ![...visited.values()].some((entry) => entry.trades.length);
        status.textContent = !result.total ? "No tracked trades."
          : `Page ${ui.format(result.page)} of ${ui.format(result.pages)} · ${ui.format(result.total)} tracked`;
        records.replaceChildren(...result.trades.map((trade) => tradeCard(trade, assetId)));
        if (result.total && !result.trades.length) {
          records.append(element("p", "roxol-history-note", "No two-sided trade records on this page."));
        }
      }
      previous.disabled = !current || current.page <= 1;
      next.disabled = !current || current.page >= current.pages;
    }

    previous.addEventListener("click", () => { void load(current.page - 1); });
    next.addEventListener("click", () => { void load(current.page + 1); });
    retry.addEventListener("click", () => { void load(requestedPage); });
    exportButton.addEventListener("click", () => download(assetId, sourceUrl, visited));
    void load(1);
  }

  return { open };
})();
