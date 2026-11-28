const RoxolOverpay = (() => {
  const ui = RoxolMarketUI;
  const { element, tradingFigure: figure, tradingStat: stat } = ui;
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
  const proofChannel = "https://discord.com/channels/415246288779608064/535250426061258753";

  function direction(label, action, median) {
    const row = stat(label, median === 0 ? "Even trade" : "");
    if (median !== 0) {
      row.lastElementChild.append(
        `You typically ${action} `,
        element("strong", "roxol-overpay-amount", amount.format(Math.abs(median))),
        median > 0 ? " more" : " less",
      );
    }
    return row;
  }

  function proofRow(trade) {
    const row = element("li", "roxol-overpay-trade");
    const details = element("div");
    const basket = element("div", "roxol-overpay-basket", trade.opposite);
    details.append(basket, ui.link(
      Number.isFinite(Date.parse(trade.date)) ? date.format(new Date(trade.date)) : "View proof",
      trade.discordUrl, true,
    ));
    const value = element("div", "roxol-overpay-trade-values");
    value.append(figure(trade.net));
    if (trade.focalValue) value.append(figure(trade.net / trade.focalValue, true));
    row.append(details, value);
    return row;
  }

  function render(panel, data, assetId) {
    if (data.median !== null) {
      const directions = element("dl", "roxol-overpay-directions roxol-overpay-rate");
      directions.append(
        direction("Upgrade into this item", "pay", data.median),
        direction("Downgrade this item", "receive", data.median),
      );
      panel.append(directions);
    }

    const details = element("details", "roxol-disclosure roxol-overpay-details");
    const stats = element("dl", "roxol-stat-grid");
    stats.append(
      stat("Priced trades", ui.format(data.trades.length)),
      stat("Proof posts", ui.format(data.postCount)),
      stat("Median net overpay", figure(data.median)),
      stat("Median net overpay %", figure(data.medianPercent == null ? null : data.medianPercent / 100, true)),
    );
    if (data.unpricedPosts) stats.append(stat("Posts outside the estimate", ui.format(data.unpricedPosts)));
    details.append(
      element("summary", "", "Estimate details"), stats,
      element("p", "roxol-overpay-note",
        "Uses the totals reported in proof captions of any age where this item was traded on its own. A caption can also report the overpay directly. The estimate reflects values and any Robux as reported."),
    );
    const download = ui.button("Download proof audit");
    download.addEventListener("click", () => ui.downloadJson(`roxol-overpay-${assetId}.json`, {
      assetId, source: "Nevos", exportedAt: new Date().toISOString(), ...data,
    }));
    details.append(download);
    panel.append(details);
    if (!data.trades.length) return;

    const history = element("details", "roxol-disclosure roxol-overpay-details roxol-overpay-history");
    const list = element("ul", "roxol-overpay-trades");
    history.append(element("summary", "", `Priced proofs (${ui.format(data.trades.length)})`), list);
    history.addEventListener("toggle", () => {
      if (history.open && !list.childElementCount) list.append(...data.trades.map(proofRow));
    });
    panel.append(history);
  }

  function mount(assetId, listingName) {
    const panel = element("section", "roxol-market roxol-overpay");
    panel.setAttribute("aria-label", "Trade proof overpay");
    const header = element("header", "roxol-overpay-header");
    header.append(element("h2", "roxol-trading-heading", "Trade proof overpay"),
      ui.link("Rolimon’s proof channel", proofChannel, true));
    const status = element("p", "roxol-overpay-note", "Loading trade proofs…");
    status.setAttribute("role", "status");
    panel.append(header, status);

    async function refresh() {
      const data = await ui.request("overpay", { assetId, listingName });
      if (data?.status !== "ok") {
        const messages = {
          "token-required": "Add your Nevos proof token in the Roxol toolbar popup, then refresh.",
          "access-denied": "Nevos denied access. Check your proof token in the Roxol toolbar popup.",
          "rate-limited": "Nevos asked Roxol to slow down. Try again shortly.",
        };
        status.textContent = messages[data?.reason] ?? "Trade proof data is unavailable.";
        return;
      }
      const notices = [];
      if (data.partial) notices.push("Nevos returned only part of its proof history.");
      if (data.median === null) notices.push("No proof captions with clear overpay for this item.");
      status.textContent = notices.join(" ");
      status.hidden = !notices.length;
      render(panel, data, assetId);
    }

    void refresh();
    return panel;
  }

  return { mount };
})();
