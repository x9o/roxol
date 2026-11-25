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
  const confidenceLabels = { insufficient: "Insufficient sample", low: "Low confidence", standard: "Standard confidence" };
  const confidenceReasons = {
    "fewer-than-10-balanced-trades": "fewer than 10 retained trades",
    "fewer-than-30-balanced-trades": "fewer than 30 retained trades",
    "pricing-coverage-below-80-percent": "pricing coverage below 80%",
    "more-than-10-percent-severely-imbalanced": "more than 10% of priced trades severely imbalanced",
  };

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
    if (trade.imbalanced) caption.append(" · Severe imbalance");
    if (trade.overpay == null) caption.append(" · Unpriced");
    const values = element("div", "roxol-overpay-trade-values");
    values.append(figure(trade.overpay, signed), figure(trade.percent == null ? null : trade.percent / 100, percent));
    const details = element("div");
    details.append(received, caption);
    row.append(details, values);
    return row;
  }

  function statistics({ overpay, overpayPercent }) {
    const stats = element("dl", "roxol-overpay-stats");
    stats.append(
      stat("Median OP", figure(overpay.median, signed)),
      stat("Median OP %", figure(overpayPercent.median == null ? null : overpayPercent.median / 100, percent)),
      stat("OP interquartile range", overpay.iqr == null ? "—" : spread.format(overpay.iqr)),
    );
    return stats;
  }

  function renderGroup(body, { summary, history }, preserveOpen = false) {
    const { sampleSize, recency, valuationCoverage, marketRate, severeImbalances } = summary;
    const { firstPricedObservationAt, lastPricedObservationAt } = recency;
    const dates = sampleSize
      ? date.formatRange(new Date(firstPricedObservationAt), new Date(lastPricedObservationAt)) : "—";
    const raw = statistics(summary);
    raw.append(stat("Priced trades", `${ui.format(sampleSize)} of ${ui.format(valuationCoverage.eligibleTrades)}`),
      stat("Priced dates (UTC)", dates));
    const market = statistics(marketRate);
    market.append(stat("Retained trades", ui.format(marketRate.sampleSize)),
      stat("Severe imbalances excluded", ui.format(severeImbalances)));
    const explanation = marketRate.confidenceReasons.map((reason) => confidenceReasons[reason]).join(", ");
    body.replaceChildren(
      element("h3", "roxol-overpay-list-heading", "Raw trade statistics"), raw,
      element("h3", "roxol-overpay-list-heading", "Market-rate estimate"), market,
      element("p", "roxol-overpay-note", confidenceLabels[marketRate.confidence] + (explanation ? ` (${explanation}).` : ".")),
    );
    if (!history.length) return;
    const list = element("ul", "roxol-overpay-trades");
    list.append(...history.slice(0, 5).map(tradeRow));
    body.append(element("h3", "roxol-overpay-list-heading", "Recent trades"), list);
    if (history.length <= 5) return;
    const disclosure = element("details", "roxol-overpay-history");
    const toggle = element("summary", "", `Show full sampled history (${ui.format(history.length)} trades)`);
    disclosure.append(toggle);
    function renderOlder() {
      toggle.textContent = disclosure.open ? "Hide older trades" : `Show full sampled history (${ui.format(history.length)} trades)`;
      if (!disclosure.open || disclosure.querySelector("ul")) return;
      const older = element("ul", "roxol-overpay-trades");
      older.append(...history.slice(5).map(tradeRow));
      disclosure.append(older);
    }
    disclosure.addEventListener("toggle", renderOlder);
    body.append(disclosure);
    disclosure.open = preserveOpen;
    if (preserveOpen) renderOlder();
  }

  function mount(assetId) {
    const panel = element("section", "roxol-market roxol-overpay");
    panel.setAttribute("aria-label", "Overpay");
    const header = element("header", "roxol-overpay-header");
    header.append(element("h2", "roxol-overpay-heading", "Overpay"),
      ui.link("RoUtility", `https://routility.io/catalog/${assetId}/trades`, true));
    const status = element("p", "roxol-overpay-note", "Loading overpay…");
    status.setAttribute("role", "status");
    const progress = element("ul", "roxol-overpay-progress");
    const progressRows = {};
    for (const [group, label] of [["swap", "One-for-one"], ["downgrade", "One-for-many"]]) {
      const row = element("li");
      const title = element("span", "", label);
      const count = element("span");
      const bar = element("progress");
      bar.setAttribute("aria-label", label + " historical valuation coverage");
      row.append(title, count, bar);
      progress.append(row);
      progressRows[group] = { count, bar };
    }
    const estimateStatus = element("p", "roxol-overpay-estimate-status");
    estimateStatus.hidden = true;
    panel.append(header, status);

    const filter = element("div", "roxol-overpay-filter");
    filter.setAttribute("role", "group");
    filter.setAttribute("aria-label", "Trade type");
    const body = element("div", "roxol-overpay-body");
    const auditNote = element("p", "roxol-overpay-note");
    const download = ui.button("Download sample audit");
    const note = element("p", "roxol-overpay-note",
      "Last 30 days of first observations, up to 500 records. OP uses historical Rolimon’s Value or RAP. The market estimate excludes trades where one basket was worth more than twice the other. Robux side payments are unknown.");
    const options = { swap: ui.button("One-for-one"), downgrade: ui.button("One-for-many") };
    let selected;
    let sample;
    let revision;
    let unavailableAttempts = 0;

    function select(group, preserveOpen = false) {
      selected = group;
      const older = preserveOpen && body.querySelector(".roxol-overpay-history[open]");
      const scroll = older?.querySelector("ul")?.scrollTop;
      const focused = preserveOpen ? [...body.querySelectorAll("summary, a")].indexOf(document.activeElement) : -1;
      for (const [key, button] of Object.entries(options)) button.setAttribute("aria-pressed", String(group === key));
      const { valuationCoverage } = sample.groups[group].summary;
      estimateStatus.hidden = !sample.partial && !valuationCoverage.pendingTrades;
      estimateStatus.textContent = estimateStatus.hidden ? "" :
        "Preliminary estimates. Statistics may change as more history is priced.";
      renderGroup(body, sample.groups[group], !!older);
      const restoredList = older && body.querySelector(".roxol-overpay-history ul");
      if (scroll && restoredList) restoredList.scrollTop = scroll;
      if (focused >= 0) body.querySelectorAll("summary, a")[focused]?.focus({ preventScroll: true });
    }

    for (const [group, button] of Object.entries(options)) {
      button.addEventListener("click", () => select(group));
      filter.append(button);
    }
    const sourceUrl = `https://routility.io/catalog/${assetId}/trades`;
    download.addEventListener("click", () => ui.downloadJson(`roxol-overpay-${assetId}.json`, {
      source: "RoUtility", sourceUrl, assetId, exportedAt: new Date().toISOString(),
      ...sample, trades: sample.audit.flatMap(({ trade, exclusion }) => trade && !exclusion ? [trade] : []),
    }));

    function schedule(delay) {
      setTimeout(() => {
        if (panel.isConnected) void refresh();
      }, delay);
    }

    async function refresh() {
      const data = await ui.request("overpay", { assetId, revision });
      if (data?.status === "unchanged" || data?.status === "loading") {
        schedule(2000);
        return;
      }
      if (data?.status !== "ok") {
        status.hidden = false;
        status.textContent = sample ? "The latest overpay refresh was unavailable." : "RoUtility trade data is unavailable.";
        if (++unavailableAttempts <= 3) schedule(20_000);
        return;
      }
      unavailableAttempts = 0;
      revision = data.revision;
      const first = !sample;
      sample = data;
      if (first) panel.append(progress, filter, estimateStatus, body, auditNote, download, note);
      const notices = [];
      if (data.partial) notices.push("RoUtility history could only be partially refreshed.");
      if (data.pricingActive) notices.push("Pricing sampled trades…");
      else if (data.pricingRetryAt) {
        const next = new Date(data.pricingRetryAt).toLocaleTimeString();
        const limited = data.retryReason === "deferred-provider-cooldown" ||
          data.retryReason === "deferred-local-request-budget";
        notices.push(limited ? `Waiting for the historical profile request limit. Resumes at ${next}.` :
          `Waiting to retry historical valuations at ${next}.`);
      } else if (data.pricingIncomplete) notices.push("Some trades lack enough historical data to price.");
      const announcement = notices.join(" ");
      if (status.textContent !== announcement) status.textContent = announcement;
      status.hidden = !notices.length;

      for (const [group, { count, bar }] of Object.entries(progressRows)) {
        const { pricedTrades, eligibleTrades, pendingTrades, unavailableTrades } =
          data.groups[group].summary.valuationCoverage;
        const coverage = eligibleTrades ? ` (${Math.floor(pricedTrades * 100 / eligibleTrades)}%)` : "";
        const waiting = pendingTrades ? ` · ${ui.format(pendingTrades)} pending` : "";
        const unavailable = unavailableTrades ? ` · ${ui.format(unavailableTrades)} unavailable` : "";
        count.textContent = `${ui.format(pricedTrades)} of ${ui.format(eligibleTrades)} priced${coverage}${waiting}${unavailable}`;
        bar.max = eligibleTrades || 1;
        bar.value = pricedTrades;
      }
      const excluded = Object.values(data.exclusions).reduce((sum, count) => sum + count, 0);
      auditNote.textContent = `${ui.format(data.audit.length)} sampled records · ${ui.format(excluded)} excluded before trade statistics`;
      select(selected ?? (data.groups.downgrade.history.length ? "downgrade" : "swap"), true);
      if (data.pricingActive) schedule(2000);
      else if (data.pricingRetryAt) {
        schedule(Math.max(1000, Math.min(2_147_483_647, data.pricingRetryAt - Date.now() + 100)));
      }
    }

    void refresh();
    return panel;
  }

  return { mount };
})();
