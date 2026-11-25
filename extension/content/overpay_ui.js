const RoxolOverpay = (() => {
  const ui = RoxolMarketUI;
  const { element } = ui;
  const signed = new Intl.NumberFormat(undefined, { signDisplay: "exceptZero", maximumFractionDigits: 1 });
  const spread = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(undefined, {
    style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 1,
  });
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
  const observationTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  });

  function figure(value, formatter) {
    const number = element("span", "roxol-overpay-figure", value == null ? "—" : formatter.format(value));
    if (value) number.dataset.direction = value > 0 ? "up" : "down";
    return number;
  }

  function stat(label, content) {
    const cell = element("div");
    const value = element("dd");
    value.append(content);
    cell.append(element("dt", "", label), value);
    return cell;
  }

  function tradeRow(trade) {
    const row = element("li", "roxol-overpay-trade");
    const received = element("ul", "roxol-overpay-basket");
    const items = new Map();
    for (const item of trade.opposite) {
      const previous = items.get(item.assetId);
      items.set(item.assetId, {
        name: previous?.name || item.name,
        quantity: (previous?.quantity ?? 0) + item.quantity,
      });
    }
    for (const [assetId, { name, quantity }] of items) {
      const item = element("li");
      const label = name || `Asset ${assetId}`;
      item.append(ui.link(label, RoxolTargets.robloxItemUrl({ kind: "asset", id: assetId }), true));
      if (quantity > 1) item.append(` ×${ui.format(quantity)}`);
      received.append(item);
    }
    const observed = element("time", "", observationTime.format(new Date(trade.observedAt)) + " UTC");
    observed.dateTime = trade.observedAt;
    const caption = element("div", "roxol-overpay-caption");
    caption.append(observed);
    if (trade.inferred) caption.append(" · Inferred");
    const values = element("div", "roxol-overpay-trade-values");
    values.append(figure(trade.overpay, signed), figure(trade.percent == null ? null : trade.percent / 100, percent));
    const details = element("div");
    details.append(received, caption);
    row.append(details, values);
    return row;
  }

  function renderGroup(body, { summary, history }) {
    const { sampleSize, confidence, recency, valuationCoverage, overpay, overpayPercent } = summary;
    const { firstPricedObservationAt, lastPricedObservationAt } = recency;
    const dates = sampleSize
      ? date.formatRange(new Date(firstPricedObservationAt), new Date(lastPricedObservationAt)) : "—";
    const medianPercent = overpayPercent.median == null ? null : overpayPercent.median / 100;
    const stats = element("dl", "roxol-overpay-stats");
    stats.append(
      stat("Median OP", figure(overpay.median, signed)),
      stat("Median OP %", figure(medianPercent, percent)),
      stat("OP interquartile range", overpay.iqr == null ? "—" : spread.format(overpay.iqr)),
      stat("Priced trades", `${ui.format(sampleSize)} of ${ui.format(valuationCoverage.eligibleTrades)}`),
      stat("Priced dates (UTC)", dates),
    );
    body.replaceChildren(stats);
    if (confidence !== "standard") {
      body.append(element("p", "roxol-overpay-note", confidence === "insufficient"
        ? "Insufficient sample (fewer than 10 priced trades)."
        : "Low confidence (fewer than 30 priced trades)."));
    }
    if (!history.length) return;
    const list = element("ul", "roxol-overpay-trades");
    list.append(...history.slice(0, 5).map(tradeRow));
    body.append(element("h3", "roxol-overpay-list-heading", "Recent trades"), list);
    if (history.length <= 5) return;
    const disclosure = element("details", "roxol-overpay-history");
    const toggle = element("summary", "", `Show full sampled history (${ui.format(history.length)} trades)`);
    disclosure.append(toggle);
    disclosure.addEventListener("toggle", () => {
      toggle.textContent = disclosure.open ? "Hide older trades" : `Show full sampled history (${ui.format(history.length)} trades)`;
      if (!disclosure.open || disclosure.querySelector("ul")) return;
      const older = element("ul", "roxol-overpay-trades");
      older.append(...history.slice(5).map(tradeRow));
      disclosure.append(older);
    });
    body.append(disclosure);
  }

  function mount(assetId) {
    const panel = element("section", "roxol-market roxol-overpay");
    panel.setAttribute("aria-label", "Overpay");
    const header = element("header", "roxol-overpay-header");
    header.append(element("h2", "roxol-overpay-heading", "Overpay"),
      ui.link("RoUtility", `https://routility.io/catalog/${assetId}/trades`, true));
    const status = element("p", "roxol-overpay-note", "Loading overpay…");
    status.setAttribute("role", "status");
    panel.append(header, status);

    void ui.request("overpay", { assetId }).then((data) => {
      if (data?.status !== "ok") {
        status.textContent = "RoUtility trade data is unavailable.";
        return;
      }
      const { swap, downgrade } = data.groups;
      const notices = [];
      if (data.partial) notices.push("RoUtility history could only be partially refreshed.");
      if (data.pricingIncomplete) notices.push("Some Rolimon’s profiles were unavailable during pricing.");
      if (notices.length) status.textContent = notices.join(" ");
      else status.remove();
      const filter = element("div", "roxol-overpay-filter");
      filter.setAttribute("role", "group");
      filter.setAttribute("aria-label", "Trade type");
      const body = element("div", "roxol-overpay-body");
      const options = [[ui.button("One-for-one"), swap], [ui.button("One-for-many"), downgrade]];
      function select(group) {
        for (const [button, option] of options) button.setAttribute("aria-pressed", String(option === group));
        renderGroup(body, group);
      }
      for (const [button, group] of options) {
        button.addEventListener("click", () => select(group));
        filter.append(button);
      }
      const note = element("p", "roxol-overpay-note",
        "Last 30 days of first observations, up to 500 tracked records. OP is the value received minus this item’s value, using historical Rolimon’s Value or RAP. Robux side payments are unknown.");
      panel.append(filter, body, note);
      select(downgrade.history.length ? downgrade : swap);
    });

    return panel;
  }

  return { mount };
})();
