const RoxolOverpay = (() => {
  const ui = RoxolMarketUI;
  const { element, tradingFigure: figure, tradingStat: stat } = ui;
  const spread = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
  const observationTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  });
  const confidenceLabels = { insufficient: "Insufficient", low: "Low", standard: "Standard" };
  const confidenceReasons = {
    "fewer-than-10-balanced-trades": "fewer than 10 retained trades",
    "fewer-than-30-balanced-trades": "fewer than 30 retained trades",
    "pricing-coverage-below-80-percent": "pricing coverage below 80%",
    "more-than-10-percent-severely-imbalanced": "more than 10% of priced trades severely imbalanced",
  };
  const exclusionLabels = {
    "outside-window": "Outside the 30-day window",
    "invalid-source-record": "Invalid source record",
    "missing-basket": "Missing basket",
    "target-absent": "Page item absent",
    "duplicate-trade": "Duplicate trade",
    "invalid-observation-time": "Invalid observation time",
    "invalid-basket": "Invalid basket",
    "duplicate-copy-id": "Duplicate item copy",
    "same-asset-on-both-sides": "Same item on both sides",
    "many-for-many": "Many-for-many",
    "target-bundled": "Page item bundled with others",
  };

  function percentage(value) {
    return figure(value == null ? null : value / 100, true);
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
    values.append(figure(trade.overpay), percentage(trade.percent));
    const details = element("div");
    details.append(received, caption);
    row.append(details, values);
    return row;
  }

  function statistics({ overpay, overpayPercent }) {
    const stats = element("dl", "roxol-stat-grid");
    stats.append(
      stat("Median OP", figure(overpay.median)),
      stat("Median OP %", percentage(overpayPercent.median)),
      stat("OP interquartile range", overpay.iqr == null ? "—" : spread.format(overpay.iqr)),
    );
    return stats;
  }

  function renderGroup(rate, details, trades, { summary, history }, preliminary, preserveOpen) {
    const { sampleSize, recency, valuationCoverage, marketRate, severeImbalances } = summary;
    const insufficient = marketRate.confidence === "insufficient";
    const headline = preliminary ? "Preliminary estimate" : insufficient ? "Insufficient data" : "Market-rate estimate";
    const stats = element("dl", "roxol-stat-grid roxol-stat-grid-primary");
    stats.append(
      stat("Median OP", figure(preliminary || insufficient ? null : marketRate.overpay.median)),
      stat("Median OP %", percentage(preliminary || insufficient ? null : marketRate.overpayPercent.median)),
      stat("Retained trades", ui.format(marketRate.sampleSize)),
      stat("Confidence", preliminary ? "Pending" : confidenceLabels[marketRate.confidence]),
    );
    rate.replaceChildren(element("h3", "roxol-trading-subheading", headline), stats);
    if (preliminary || insufficient) {
      rate.append(element("p", "roxol-overpay-note", preliminary
        ? "Market rate pending. Sample medians are in Estimate details."
        : "A market rate requires at least 10 retained trades."));
    }
    const { firstPricedObservationAt, lastPricedObservationAt } = recency;
    const dates = sampleSize
      ? date.formatRange(new Date(firstPricedObservationAt), new Date(lastPricedObservationAt)) : "—";
    const raw = statistics(summary);
    raw.append(stat("Priced trades", `${ui.format(sampleSize)} of ${ui.format(valuationCoverage.eligibleTrades)}`),
      stat("Priced dates (UTC)", dates));
    const market = statistics(marketRate);
    market.append(stat("Severe imbalances excluded", ui.format(severeImbalances)));
    const explanation = marketRate.confidenceReasons.map((reason) => confidenceReasons[reason]).join(", ");
    details.replaceChildren(
      element("h3", "roxol-trading-subheading", "Raw trade statistics"), raw,
      element("h3", "roxol-trading-subheading", "Filtered sample statistics"), market,
      element("p", "roxol-overpay-note",
        `Sample confidence: ${confidenceLabels[marketRate.confidence].toLowerCase()}${explanation ? ` (${explanation})` : ""}.`),
    );
    trades.replaceChildren();
    trades.parentElement.hidden = !history.length;
    trades.previousElementSibling.textContent = `Sampled trades (${ui.format(history.length)})`;
    if (!history.length) return;
    const list = element("ul", "roxol-overpay-trades");
    list.append(...history.slice(0, 5).map(tradeRow));
    trades.append(list);
    if (history.length <= 5) return;
    const disclosure = element("details", "roxol-overpay-history roxol-disclosure");
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
    trades.append(disclosure);
    disclosure.open = preserveOpen;
    if (preserveOpen) renderOlder();
  }

  function mount(assetId) {
    const panel = element("section", "roxol-market roxol-overpay");
    panel.setAttribute("aria-label", "Overpay");
    const header = element("header", "roxol-overpay-header");
    header.append(element("h2", "roxol-trading-heading", "Overpay"),
      ui.link("RoUtility", `https://routility.io/catalog/${assetId}/trades`, true));
    const status = element("p", "roxol-overpay-note", "Loading overpay…");
    status.setAttribute("role", "status");
    const progress = element("ul", "roxol-overpay-progress");
    const progressRows = {};
    for (const [group, label] of [["swap", "One-for-one"], ["downgrade", "One-for-many"]]) {
      const row = element("li");
      const count = element("span");
      const bar = element("progress", "roxol-progress-bar");
      bar.setAttribute("aria-label", label + " historical valuation coverage");
      row.append(count, bar);
      progress.append(row);
      progressRows[group] = { row, count, bar };
    }
    status.classList.add("roxol-loading-status");
    status.setAttribute("aria-busy", "true");
    panel.append(header, status);

    const filter = element("div", "roxol-segments");
    filter.setAttribute("role", "group");
    filter.setAttribute("aria-label", "Trade type");
    const rate = element("div", "roxol-overpay-rate");
    const details = element("details", "roxol-disclosure roxol-overpay-details");
    const statisticsBody = element("div");
    const history = element("details", "roxol-disclosure roxol-overpay-details");
    const trades = element("div");
    history.append(element("summary"), trades);
    const auditNote = element("p", "roxol-overpay-note");
    const exclusions = element("dl", "roxol-stat-grid");
    const download = ui.button("Download sample audit");
    const note = element("p", "roxol-overpay-note",
      "Up to 500 records first observed in the past 30 days. OP is the other basket’s historical Rolimon’s Value or RAP minus the isolated item’s. OP percentage uses the isolated item as the baseline. The filter excludes trades where one basket was worth more than twice the other. Robux side payments are unknown.");
    details.append(element("summary", "", "Estimate details"), statisticsBody, note, auditNote, exclusions, download);
    const options = { swap: ui.button("One-for-one"), downgrade: ui.button("One-for-many") };
    let selected;
    let sample;
    let revision;
    let unavailableAttempts = 0;

    function select(group, preserveOpen = false) {
      selected = group;
      const older = preserveOpen ? trades.querySelector(".roxol-overpay-history[open]") : null;
      const scroll = older?.querySelector("ul")?.scrollTop;
      const focused = preserveOpen ? [...trades.querySelectorAll("summary, a")].indexOf(document.activeElement) : -1;
      for (const [key, button] of Object.entries(options)) button.setAttribute("aria-pressed", String(group === key));
      const { valuationCoverage } = sample.groups[group].summary;
      for (const [key, { row }] of Object.entries(progressRows)) row.hidden = key !== group;
      renderGroup(rate, statisticsBody, trades, sample.groups[group],
        sample.partial || !!valuationCoverage.pendingTrades, !!older);
      const restoredList = older && trades.querySelector(".roxol-overpay-history ul");
      if (scroll && restoredList) restoredList.scrollTop = scroll;
      if (focused >= 0) trades.querySelectorAll("summary, a")[focused]?.focus({ preventScroll: true });
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
      status.removeAttribute("aria-busy");
      if (data?.status !== "ok") {
        status.removeAttribute("data-loading");
        status.hidden = false;
        status.textContent = sample ? "The latest overpay refresh was unavailable." : "RoUtility trade data is unavailable.";
        if (++unavailableAttempts <= 3) schedule(20_000);
        return;
      }
      unavailableAttempts = 0;
      revision = data.revision;
      const first = !sample;
      sample = data;
      if (first) panel.append(filter, rate, progress, details, history);
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
      status.toggleAttribute("data-loading", !!data.pricingActive);

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
      exclusions.replaceChildren(...Object.entries(data.exclusions)
        .map(([reason, count]) => stat(exclusionLabels[reason] ?? reason, ui.format(count))));
      exclusions.hidden = !excluded;
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
