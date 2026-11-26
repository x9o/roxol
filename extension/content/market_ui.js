const RoxolMarketUI = (() => {
  const { keyOf, robloxItemUrl, rolimonsSalesUrl } = RoxolTargets;
  const numberFormat = new Intl.NumberFormat();
  const dailySalesFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dailySalesTooltip = "Resale activity · Average daily resales tracked by Rolimon’s.";
  const percentFormat = new Intl.NumberFormat(undefined, { style: "percent" });
  const dealFormat = new Intl.NumberFormat(undefined, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 1 });
  const dateFormat = new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
  const saleDateFormat = new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "UTC",
  });
  const badgeNames = {
    value_20m: "20M+", value_10m: "10M+", value_5m: "5M+", value_1m: "1M+",
    value_500k: "500K+", value_100k: "100K+", value_1000_trade_ads: "Active Trader",
    roli_award_winner: "Roli Award Winner", roli_award_nominee: "Roli Award Nominee",
    own_lucky_cat_uaid: "Lucky Cat", own_1_serial_1: "Serial #1", own_1_serial_1337: "L337",
    own_1_sequential_serial: "Sequential Serial", own_1_serial_1_to_9: "Low Serial",
    own_1_big_dominus: "Big Dominator", own_1_dominus: "Dominator", own_1_stf: "Sparkly",
    own_1_valued_federation_item: "Federated", own_1_immortal_sword: "Enduring",
    own_epic_katana_set: "Epic Blade Collector", own_1_kotn_item: "Evening Royalty",
    own_15_noob: "Noobie", own_5_noob: "Noob", own_10_rares: "Rare Supremist",
    own_3_rares: "Rare Enthusiast", own_1_rare: "Rare Owner", create_10000_trade_ads: "Boundless Trader",
    create_100_trade_ads: "Frequent Trader",
    create_10_trade_ads: "Trade Advertiser", own_all_asset_types: "Accessorized",
    own_50_pct_of_1_item: "Uncontrollable Addiction", own_25_pct_of_1_item: "Unhealthy Obsession",
    own_10_pct_of_1_item: "Modest Enthusiasm", own_100_of_1_item: "Mega Hoarder",
    own_50_of_1_item: "Hoarder", own_10_of_1_item: "Mini Hoarder", own_1000_items: "Incurable Collector",
    own_100_items: "Devout Collector", own_10_items: "Collector", contributor: "Contributor",
    sword_fighting_champion: "Sword Fighting Champion", event_winner: "Event Winner",
    game_night_winner: "Game Night Winner", booster: "Booster", verified: "Verified", roligang: "Roligang",
  };
  let activeDialog;
  let positionActivePreview;
  let positionActiveSale;
  let activeCardTooltip;
  let salesPreviewCount = 0;
  let cardAnchorCount = 0;

  function positionSalesOverlays() {
    positionActivePreview?.();
    positionActiveSale?.();
    activeCardTooltip?.position();
  }

  window.addEventListener("resize", positionSalesOverlays);
  window.addEventListener("scroll", positionSalesOverlays, { capture: true, passive: true });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function link(text, url, external = false) {
    const anchor = element("a", "roxol-link", text);
    anchor.href = url;
    if (external) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    return anchor;
  }

  function titleLink(label, url) {
    const anchor = link("", url, true);
    anchor.className = "roxol-title-link";
    anchor.setAttribute("aria-label", label);
    anchor.title = label;
    anchor.append(element("span", "roxol-external-icon"));
    return anchor;
  }

  function button(text) {
    const node = element("button", "roxol-button", text);
    node.type = "button";
    return node;
  }

  function icon(name) {
    const img = element("img", "roxol-icon");
    img.src = chrome.runtime.getURL(`assets/${name}.png`);
    img.alt = "";
    img.width = 14;
    img.height = 14;
    return img;
  }

  function symbol(name) {
    const node = element("span", `roxol-market-symbol roxol-${name}-icon`);
    node.setAttribute("aria-hidden", "true");
    return node;
  }

  function format(value) {
    return value == null ? "Unavailable" : numberFormat.format(value);
  }

  const signedNumber = new Intl.NumberFormat(undefined, { signDisplay: "exceptZero", maximumFractionDigits: 1 });
  const signedPercent = new Intl.NumberFormat(undefined, {
    style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 1,
  });

  function tradingFigure(value, percentage = false) {
    const formatter = percentage ? signedPercent : signedNumber;
    const number = element("span", "roxol-number", value == null ? "—" : formatter.format(value));
    if (value) number.dataset.direction = value > 0 ? "up" : "down";
    return number;
  }

  function tradingStat(label, content) {
    const cell = element("div");
    const value = element("dd");
    value.append(content);
    cell.append(element("dt", "", label), value);
    return cell;
  }

  function metric(label, iconName, value) {
    const row = element("div", "roxol-metric");
    const caption = element("dt", "", label);
    caption.prepend(icon(iconName));
    const figure = element("dd", "", format(value));
    row.append(caption, figure);
    return { row, figure };
  }

  function request(type, payload = {}) {
    return chrome.runtime.sendMessage({ type: `roxol:market-${type}`, ...payload })
      .catch(() => ({ status: "unavailable" }));
  }

  function downloadJson(filename, report) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + "\n"], { type: "application/json" }));
    const anchor = element("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function rolimonsItemUrl(item) {
    return RolimonsItemDetails.profile_url(item.id, null, { isBundle: item.kind === "bundle" });
  }

  function rolimonsSalesLink(item) {
    const anchor = link("Sales on Rolimon’s", rolimonsSalesUrl(item), true);
    anchor.prepend(icon("rolimons"));
    return anchor;
  }

  function closeDialog() {
    activeDialog?.close();
    activeDialog?.remove();
    activeDialog = null;
  }

  function showDialog(title) {
    closeDialog();
    const dialog = element("dialog", "roxol-market roxol-dialog");
    dialog.setAttribute("aria-label", title);
    const header = element("header", "roxol-dialog-header");
    const close = button("Close");
    close.addEventListener("click", closeDialog);
    header.append(element("h2", "", title), close);
    const body = element("div", "roxol-dialog-body");
    dialog.append(header, body);
    dialog.addEventListener("close", () => {
      if (activeDialog === dialog) activeDialog = null;
      dialog.remove();
    });
    document.body.append(dialog);
    activeDialog = dialog;
    dialog.showModal();
    return body;
  }

  function makeTable(columns) {
    const table = element("table", "roxol-table");
    const headers = table.createTHead().insertRow();
    for (const name of columns) {
      const cell = element("th", "", name);
      cell.scope = "col";
      headers.append(cell);
    }
    return { table, rows: table.createTBody() };
  }

  function renderChart(points, label) {
    const figure = element("figure", "roxol-chart");
    const ordered = [...points].sort((a, b) => a.time_ms - b.time_ms);
    let min = ordered[0].value;
    let max = min;
    for (const { value } of ordered) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const first = ordered[0].time_ms;
    const span = ordered.at(-1).time_ms - first || 1;
    const canvas = element("canvas");
    canvas.width = 640;
    canvas.height = 138;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${label} range from ${format(min)} to ${format(max)} Robux`);
    const ctx = canvas.getContext("2d");
    if (!ctx) return figure;

    ctx.lineWidth = 1;
    ctx.strokeStyle = "#76857c";
    for (const y of [12, 69, 126]) {
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(632, y);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = getComputedStyle(activeDialog).getPropertyValue("--roxol-accent").trim();
    ctx.beginPath();
    ordered.forEach(({ time_ms, value }, index) => {
      const x = 8 + 624 * (time_ms - first) / span;
      const y = min === max ? 69 : 126 - 114 * (value - min) / (max - min);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (ordered.length === 1) {
      ctx.beginPath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.arc(320, 69, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const caption = `${dateFormat.format(first)} – ${dateFormat.format(ordered.at(-1).time_ms)} · ${format(min)}–${format(max)} Robux`;
    figure.append(canvas, element("figcaption", "roxol-note", caption));
    return figure;
  }

  function showDaily(body, result) {
    const points = result?.daily || [];
    if (!points.length) {
      body.replaceChildren(element("p", "roxol-note", result?.status === "ok"
        ? "Roblox has no daily resale prices for this item."
        : "Roblox daily resale prices are unavailable."));
      return;
    }

    body.replaceChildren(element("p", "roxol-note", "Source · Roblox daily resale prices"));
    if (points.length > 1) body.append(renderChart(points, "Roblox daily prices"));
    const { table, rows } = makeTable(["UTC date", "Daily price (Robux)", "Volume"]);
    for (const point of points) {
      const row = rows.insertRow();
      row.insertCell().textContent = dateFormat.format(point.time_ms);
      row.insertCell().textContent = format(point.value);
      row.insertCell().textContent = point.volume > 0 ? format(point.volume) : "—";
    }
    body.append(table);
  }

  function comparison({ price, before }) {
    if (price == null || before == null) return ["", "Unknown"];
    if (price > before) return ["up", "Above RAP"];
    if (price < before) return ["down", "Below RAP"];
    return ["", "At RAP"];
  }

  function itemBadges(meta, dailySales, { activityOnly = false, indicators = true, projected = true } = {}) {
    const badges = element("ul", "roxol-badges");
    const add = (text, title, { direction = "", iconName, rating, focusable = false } = {}) => {
      const badge = element("li", "roxol-badge", text);
      if (iconName || rating !== undefined) badge.classList.add("roxol-icon-badge");
      if (iconName) badge.prepend(symbol(iconName));
      if (rating !== undefined) badge.prepend(element("strong", "roxol-demand-rating", rating));
      badge.dataset.direction = direction;
      badge.setAttribute("aria-label", `${rating === undefined ? "" : `${rating} of 5. `}${text}. ${title}`);
      if (direction || focusable) {
        badge.dataset.tooltip = title;
        badge.tabIndex = 0;
      } else {
        badge.title = title;
      }
      badges.append(badge);
    };
    if (!activityOnly && indicators && meta?.rare) add("Rare", "Rare by Rolimon’s");
    if (!activityOnly && projected && meta?.projected) add("Projected", "Projected by Rolimon’s");
    if (!indicators) return badges;
    if (meta?.demand) add(`${meta.demand} demand`, "Demand · Rolimon’s", { rating: meta.demandRating });
    else dailySales?.then((figure) => {
      if (figure) add(`${figure} sales/day`, dailySalesTooltip, { focusable: true });
    });
    if (activityOnly || !meta) return badges;
    if (meta.trend) add(`Trend · ${meta.trend}`, "Published trend · Rolimon’s", { iconName: `trend-${meta.trend.toLowerCase()}` });
    if (meta.signal) {
      const { direction, target, threshold } = meta.signal;
      const raises = direction === "raise";
      add(raises ? "Might raise" : "Might drop",
        `Roxol estimate · Rolimon’s RAP of ${format(meta.rap)} is ${raises ? "at or above" : "below"} ${format(threshold)}. Possible value ${format(target)}.`,
        { direction: raises ? "up" : "down" });
    }
    return badges;
  }

  function cardBadge(label, iconName, variant, text = "") {
    const badge = button(text);
    badge.classList.add("roxol-card-control", `roxol-card-${variant}`);
    badge.setAttribute("aria-label", label);
    if (iconName) badge.prepend(symbol(iconName));
    const tooltip = element("span", "roxol-card-tooltip", label);
    tooltip.setAttribute("aria-hidden", "true");
    tooltip.setAttribute("popover", "manual");
    badge.append(tooltip);
    const hide = () => {
      if (tooltip.matches(":popover-open")) tooltip.hidePopover();
      if (activeCardTooltip?.hide === hide) activeCardTooltip = null;
    };
    function position() {
      if (!tooltip.matches(":popover-open")) {
        hide();
        return;
      }
      const rect = badge.getBoundingClientRect();
      const edge = document.documentElement.clientWidth - tooltip.offsetWidth - 6;
      tooltip.style.left = `${Math.max(6, Math.min(rect.left, edge))}px`;
      tooltip.style.top = `${rect.bottom + tooltip.offsetHeight + 10 <= document.documentElement.clientHeight
        ? rect.bottom + 4 : Math.max(6, rect.top - tooltip.offsetHeight - 4)}px`;
    }
    function show() {
      if (activeCardTooltip?.hide !== hide) activeCardTooltip?.hide();
      if (!tooltip.matches(":popover-open")) tooltip.showPopover();
      activeCardTooltip = { hide, position };
      position();
    }
    badge.addEventListener("focus", show);
    badge.addEventListener("blur", hide);
    badge.addEventListener("pointerenter", show);
    badge.addEventListener("pointerleave", () => {
      if (document.activeElement !== badge) hide();
    });
    badge.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hide();
    });
    badge.addEventListener("click", () => {
      badge.focus();
      show();
    });
    return badge;
  }

  function cardState(meta, { indicators = true, projected = true }) {
    const warning = projected && meta?.projected;
    if (!indicators && !warning) return null;
    if (!indicators) return cardBadge("Projected · Rolimon’s", "state-warning", "state");
    const trend = meta?.trend ? `Published trend · Rolimon’s: ${meta.trend}` : "";
    const signal = meta?.signal;
    const forecast = signal && (signal.direction === "raise" ? "Might raise" : "Might drop");
    const labels = [
      warning ? "Projected · Rolimon’s" : "",
      forecast ? `${forecast} · Roxol RAP estimate (possible value ${format(signal.target)})` : "",
      trend,
    ].filter(Boolean);
    const iconName = warning ? "state-warning" : forecast
      ? (signal.direction === "raise" ? "trend-raising" : "trend-lowering")
      : "trend-stable";
    return cardBadge(labels.join("\n") || (projected && meta?.projected === false ? "Not projected" : "State unknown"), iconName, "state");
  }

  function cardValue({ rolimons, rap }) {
    if (rolimons?.value != null) return { amount: rolimons.value };
    const fallback = rolimons?.fallbackValue ?? rolimons?.rap ?? rap ?? null;
    const label = fallback === (rolimons?.rap ?? rap) ? "RAP" : "fallback";
    return { amount: fallback, label };
  }

  function bestPriceDeals(price, rap, value) {
    const deals = element("span", "roxol-market roxol-best-price-deals");
    for (const [label, baseline] of [["RAP", rap], ["Value", value]]) {
      if (!Number.isSafeInteger(baseline) || baseline <= 0) continue;
      const difference = price - baseline;
      const percent = dealFormat.format(difference / baseline);
      const badge = element("span", "roxol-deal", `${label} ${percent}`);
      badge.title = `Best Price compared with ${label} of ${format(baseline)} Robux`;
      if (difference) badge.dataset.direction = difference < 0 ? "up" : "down";
      deals.append(badge);
    }
    return deals.childElementCount ? deals : null;
  }

  function showPlayerBadges(host, id, result) {
    const title = element("h3", "", "RoliBadges");
    if (result?.status !== "ok") {
      host.replaceChildren(title, element("p", "roxol-note", "Rolimon’s player badges are unavailable."));
      host.hidden = false;
      return;
    }
    const earned = new Set(result.badges.map((key) => key === "create_1000_trade_ads" ? "value_1000_trade_ads" : key));
    if (!earned.size) return;
    const list = element("ul", "roxol-player-badge-list");
    const keys = Object.keys(badgeNames).filter((key) => earned.delete(key));
    for (const key of [...keys, ...earned]) {
      const known = Object.hasOwn(badgeNames, key);
      const name = known ? badgeNames[key] : key.replaceAll("_", " ");
      const badge = element("li", "roxol-badge", name);
      if (known) {
        const image = element("img", "roxol-player-badge-icon");
        image.src = chrome.runtime.getURL(`assets/roliBadges/${key}.svg`);
        image.alt = "";
        image.width = image.height = 24;
        badge.prepend(image);
      }
      list.append(badge);
    }
    const provider = link("RoliBadges on Rolimon’s ↗", `https://www.rolimons.com/playerrolibadges/${id}`, true);
    host.replaceChildren(title, list, provider);
    host.hidden = false;
  }

  function showSaleMedians(host, sales, value, bestPrice) {
    const { table: summary, rows } = makeTable(["Sales", "Est. median", "% of Value", "Best Price Δ"]);
    summary.className = "roxol-sale-medians";
    summary.tHead.rows[0].cells[3].title = "Best Price percentage above or below the median";
    const caption = summary.createCaption();
    caption.textContent = "Best Price compared with recent sales";
    for (const size of [10, 30]) {
      const prices = sales.slice(0, size).map((sale) => sale.price)
        .filter((price) => Number.isSafeInteger(price) && price > 0)
        .sort((a, b) => a - b);
      const count = prices.length;
      const lower = prices[Math.floor((count - 1) / 2)];
      const upper = prices[Math.floor(count / 2)];
      const median = count ? lower + (upper - lower) / 2 : null;
      const row = rows.insertRow();
      const label = element("th", "", `Last ${size}`);
      label.scope = "row";
      if (count < size) label.append(element("small", "", `${count}/${size} priced`));
      row.append(label);
      const difference = median && bestPrice > 0 ? (bestPrice - median) / median : null;
      for (const [display, missing] of [
        [median == null ? null : format(median), "No estimated sale prices"],
        [median && value > 0 ? percentFormat.format(median / value) : null, "Estimated median or assigned Value unavailable"],
        [difference == null ? null : dealFormat.format(difference), "Estimated median or Best Price unavailable"],
      ]) {
        const cell = row.insertCell();
        cell.textContent = display ?? "—";
        if (display == null) cell.setAttribute("aria-label", missing);
      }
    }
    host.replaceChildren(summary);
  }

  function showSaleGrid(body, result, { preview = false } = {}) {
    const all = result?.sales || [];
    const sales = preview ? all.slice(0, 60) : all;
    if (!sales.length) {
      body.replaceChildren(element("p", "roxol-note", result?.status === "ok"
        ? "No tracked sales on Rolimon’s." : "Rolimon’s tracked sales are unavailable."));
      return;
    }

    const count = !preview && result.count > all.length ? `${format(all.length)} of ${format(result.count)}` : format(sales.length);
    const legend = element("div", "roxol-sale-legend");
    for (const [direction, label] of [["up", "Above RAP"], ["down", "Below RAP"], ["", "At RAP or unknown"]]) {
      const key = element("span", "", label);
      key.dataset.direction = direction;
      legend.append(key);
    }
    const shell = element("div", "roxol-sale-grid-shell");
    const grid = element("div", "roxol-sale-grid");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Tracked sales, newest first. Use arrow keys to browse.");
    const details = element("div", "roxol-sale-details");
    details.hidden = true;
    details.setAttribute("aria-live", "polite");
    let focusedIndex = 0;
    let active;
    let closeTimer;
    let aboveRap = 0;
    const marks = sales.map((sale, index) => {
      const mark = element("button", "roxol-sale-mark");
      mark.type = "button";
      mark.tabIndex = index ? -1 : 0;
      mark.dataset.sale = index;
      const [direction, label] = comparison(sale);
      if (direction === "up") aboveRap++;
      mark.dataset.direction = direction;
      mark.setAttribute("aria-label", `${saleDateFormat.format(sale.time)} UTC, estimated price ${format(sale.price)}, ${label}`);
      return mark;
    });
    grid.append(...marks);
    shell.append(grid, details);
    const summary = element("p", "roxol-sale-count", `${count} tracked sales · newest first`);
    if (preview) {
      const share = aboveRap / sales.length;
      const stat = element("span", "roxol-sale-share", `${percentFormat.format(share)} above RAP`);
      stat.title = `${format(aboveRap)} of ${count} displayed sales above pre-sale RAP`;
      const bar = element("span", "roxol-sale-share-bar");
      bar.style.setProperty("--roxol-sale-share", `${share * 100}%`);
      bar.setAttribute("aria-hidden", "true");
      stat.prepend(bar);
      summary.append(" ", stat);
    }
    body.replaceChildren(summary, legend, shell);

    function hide() {
      active?.removeAttribute("data-active");
      active = null;
      details.hidden = true;
      if (positionActiveSale === position) positionActiveSale = null;
    }

    function position() {
      const origin = active?.getBoundingClientRect();
      if (!origin?.width) {
        hide();
        return;
      }
      const bounds = shell.getBoundingClientRect();
      const container = shell.closest(".roxol-sales-preview, .roxol-dialog");
      const scroller = container.getBoundingClientRect();
      const { clientWidth, clientHeight } = document.documentElement;
      if (origin.bottom <= Math.max(0, scroller.top) || origin.top >= Math.min(clientHeight, scroller.bottom)) {
        hide();
        return;
      }
      const gap = 4;
      if (container.classList.contains("roxol-sales-preview") && !details.hasAttribute("data-interactive")) {
        const right = scroller.right + gap;
        const left = scroller.left - details.offsetWidth - gap;
        const sideX = right + details.offsetWidth < clientWidth - gap ? right : left >= gap ? left : null;
        if (sideX != null) {
          details.style.left = `${sideX}px`;
          details.style.top = `${Math.max(gap, Math.min(origin.top, clientHeight - details.offsetHeight - gap))}px`;
          return;
        }
      }
      const above = origin.bottom + details.offsetHeight + gap > clientHeight - gap;
      const x = origin.left + (origin.width - details.offsetWidth) / 2;
      const minX = Math.max(gap, Math.min(bounds.left, clientWidth - details.offsetWidth - gap));
      const maxX = Math.max(minX, Math.min(bounds.right, clientWidth - gap) - details.offsetWidth);
      const y = above ? origin.top - details.offsetHeight - gap : origin.bottom + gap;
      details.style.left = `${Math.min(Math.max(minX, x), maxX)}px`;
      details.style.top = `${Math.max(gap, y)}px`;
    }

    function show(mark) {
      clearTimeout(closeTimer);
      if (active === mark) return;
      active?.removeAttribute("data-active");
      active = mark;
      active.dataset.active = "";
      delete details.dataset.interactive;
      const sale = sales[Number(mark.dataset.sale)];
      const [direction, label] = comparison(sale);
      const timestamp = `${saleDateFormat.format(sale.time)} UTC`;
      const saleTime = sale.id ? link(timestamp, `https://www.rolimons.com/itemsale/${sale.id}`, true) : element("span", "", timestamp);
      const cue = element("strong", "", label);
      cue.dataset.direction = direction;
      const metrics = element("dl", "roxol-sale-rap");
      for (const [caption, value] of [["Est. sale price", sale.price], ["Pre-sale RAP", sale.before], ["Post-sale RAP", sale.after]]) {
        const pair = element("div");
        pair.append(element("dt", "", caption), element("dd", "", format(value)));
        metrics.append(pair);
      }
      details.replaceChildren(saleTime, cue, metrics);
      details.hidden = false;
      positionActiveSale = position;
      position();
    }

    function leave() {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (!details.contains(document.activeElement) && !active?.matches(":focus-visible")) hide();
      }, 130);
    }

    const markOf = (event) => event.target.closest(".roxol-sale-mark");
    grid.addEventListener("pointerover", (event) => {
      const mark = markOf(event);
      if (event.pointerType === "mouse" && mark) show(mark);
    });
    grid.addEventListener("pointerout", leave);
    grid.addEventListener("focusin", (event) => {
      const mark = markOf(event);
      if (!mark) return;
      marks[focusedIndex].tabIndex = -1;
      focusedIndex = Number(mark.dataset.sale);
      mark.tabIndex = 0;
      if (mark.matches(":focus-visible")) show(mark);
    });
    shell.addEventListener("focusout", leave);
    grid.addEventListener("click", (event) => {
      const mark = markOf(event);
      if (!mark) return;
      show(mark);
      details.dataset.interactive = "";
      position();
    });
    details.addEventListener("pointerenter", () => clearTimeout(closeTimer));
    details.addEventListener("pointerleave", leave);
    shell.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && active) {
        event.preventDefault();
        event.stopPropagation();
        hide();
        return;
      }
      if (!markOf(event)) return;
      const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
      if (!Object.hasOwn(offsets, event.key)) return;
      event.preventDefault();
      marks[Math.max(0, Math.min(focusedIndex + offsets[event.key], marks.length - 1))].focus();
    });
  }

  function connectSalesPreview(history, preview, body, getSales, { card, value, getBestPrice, target }) {
    let closeTimer;
    let pinned = false;
    let revision = 0;
    const isOpen = () => preview.matches(":popover-open");

    function position() {
      if (!isOpen()) return;
      const gap = 8;
      const trigger = history.getBoundingClientRect();
      const { clientWidth: width, clientHeight: height } = document.documentElement;
      const panelWidth = preview.offsetWidth;
      const right = card && width - trigger.right >= panelWidth + gap * 2;
      const left = card && trigger.left >= panelWidth + gap * 2;
      const below = height - trigger.bottom - gap * 2;
      const above = trigger.top - gap * 2;
      const side = right || left;
      const flip = !side && below < preview.scrollHeight + 2 && above > below;
      const x = right ? trigger.right + gap : left ? trigger.left - panelWidth - gap : trigger.left;
      preview.style.maxHeight = `${Math.max(0, side ? height - gap * 2 : flip ? above : below)}px`;
      const panelHeight = preview.offsetHeight;
      const y = side ? trigger.top : flip ? trigger.top - gap - panelHeight : trigger.bottom + gap;
      preview.style.left = `${Math.max(gap, Math.min(x, width - panelWidth - gap))}px`;
      preview.style.top = `${Math.max(gap, Math.min(y, height - panelHeight - gap))}px`;
    }

    async function open(pin) {
      clearTimeout(closeTimer);
      pinned = pin;
      if (isOpen()) return;
      const version = ++revision;
      body.textContent = "Loading Rolimon’s sales…";
      preview.showPopover({ source: history });
      positionActivePreview = position;
      history.setAttribute("aria-expanded", "true");
      position();
      const result = await getSales();
      if (version !== revision || !isOpen()) return;
      showSaleGrid(body, result, { preview: true });
      if (result?.sales?.length) {
        const medians = element("div", "roxol-sale-median-summary");
        const best = getBestPrice?.();
        showSaleMedians(medians, result.sales, value, best);
        body.prepend(medians);
        if (best == null && result.sales.slice(0, 30).some((sale) => sale.price > 0)) {
          void request("best-listing", { item: target }).then(({ price } = {}) => {
            if (!medians.isConnected || !isOpen()) return;
            const best = getBestPrice?.() ?? price;
            if (best != null) showSaleMedians(medians, result.sales, value, best);
          });
        }
      }
      position();
    }

    function leave() {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (isOpen() && !pinned && !preview.contains(document.activeElement)) preview.hidePopover();
      }, 180);
    }

    history.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") void open(pinned);
    });
    history.addEventListener("pointerleave", leave);
    history.addEventListener("click", () => {
      if (pinned && isOpen()) preview.hidePopover();
      else void open(true);
    });
    preview.addEventListener("pointerenter", () => clearTimeout(closeTimer));
    preview.addEventListener("pointerleave", leave);
    preview.addEventListener("focusout", leave);
    preview.addEventListener("toggle", () => {
      if (isOpen()) return;
      pinned = false;
      history.setAttribute("aria-expanded", "false");
      if (positionActivePreview === position) positionActivePreview = null;
    });
  }

  function itemPanel(item, {
    card = false, cardOverlay, nativeLabel, getBestPrice, onRap, linkValue = false,
    showValue = true, indicators = true, sales = true, projected = true,
  } = {}) {
    const panel = element("div", `roxol-market roxol-item ${card ? "roxol-card" : "roxol-item-detail clearfix item-info-row-container"}`);
    panel.dataset.roxolItem = keyOf(item);
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Roxol item information");
    const rap = metric("RAP", "robux", item.rap);
    const meta = item.rolimons;
    const target = { kind: item.kind, id: item.id };
    const dailySales = !indicators || meta?.demand ? null : request("daily-sales", { item: target }).then(({ average } = {}) =>
      Number.isFinite(average) && average >= 0 ? dailySalesFormat.format(average) : null);
    if (cardOverlay && indicators) {
      if (meta?.demand) {
        const badge = cardBadge(`Demand: ${meta.demand} (${meta.demandRating}/5)`, null, "demand", meta.demandRating);
        badge.dataset.demand = meta.demand.toLowerCase();
        cardOverlay.prepend(badge);
      } else {
        dailySales.then((figure) => {
          if (!cardOverlay.isConnected) return;
          if (figure) {
            cardOverlay.prepend(cardBadge(`${figure} sales/day · ${dailySalesTooltip}`, null, "daily-sales", `${figure} S/D`));
          } else if (meta?.demandRating === 0) {
            cardOverlay.prepend(cardBadge("Demand: Unrated by Rolimon’s", null, "demand", 0));
          }
        });
      }
    }
    const value = metric("Value", "rolimons", meta?.value);
    rap.row.title = "Recent Average Price";
    value.row.title = "Assigned value · Rolimon’s";
    if (meta?.checkedAt) value.row.title += ` · checked ${new Date(meta.checkedAt).toLocaleString()}`;
    if (meta?.value == null && meta?.fallbackValue != null) {
      const label = meta.fallbackValue === meta.rap ? "RAP" : "fallback";
      value.figure.textContent = `${format(meta.fallbackValue)} (${label})`;
      value.row.title = `Rolimon’s ${label} · no assigned value · checked ${new Date(meta.checkedAt).toLocaleString()}`;
    }
    if (cardOverlay) {
      value.row.querySelector("dt").lastChild.textContent = "Rolimon’s value";
      const result = cardValue(item);
      if (result.label && result.amount != null) {
        value.figure.textContent = `${format(result.amount)} (${result.label})`;
        value.row.title = `${meta?.rap != null || meta?.fallbackValue != null ? "Rolimon’s" : "Roblox"} ${result.label} · no assigned value`;
      }
    }
    if (showValue && linkValue) {
      const itemLink = titleLink("View item on Rolimon’s", rolimonsItemUrl(item));
      itemLink.classList.add("roxol-value-link");
      itemLink.textContent = "↗";
      for (const event of ["pointerdown", "keydown"]) {
        itemLink.addEventListener(event, (event) => event.stopPropagation());
      }
      value.figure.classList.add("roxol-value-with-link");
      value.figure.append(itemLink);
    }

    const actions = element("div", "roxol-actions");
    const history = button(cardOverlay ? "" : "Sales history");
    history.classList.add("roxol-history-trigger");
    history.setAttribute("aria-expanded", "false");
    history.setAttribute("aria-label", "Sales history");
    history.title = "Sales history";
    history.prepend(symbol("history"));
    const provider = link("Rolimon’s ↗", rolimonsItemUrl(item), true);
    if (sales) actions.append(history);
    if (card) {
      if (showValue) {
        const metrics = element("dl", "roxol-metrics roxol-item-value");
        if (nativeLabel) metrics.append(metric(nativeLabel, "robux", item.rap).row);
        metrics.append(value.row);
        panel.append(metrics);
      }
      if (!cardOverlay && indicators) panel.append(itemBadges(meta, dailySales, { activityOnly: true }));
      if (sales) (cardOverlay || panel).append(actions);
      panel.hidden = !panel.childElementCount;
    } else {
      const content = element("div", "row-content roxol-value-content");
      if (showValue || indicators) {
        panel.append(element("div", "font-header-1 text-subheader text-label row-label",
          showValue ? "Value" : "Item indicators"));
      }
      if (showValue) {
        const amount = element("div", "roxol-native-value", value.figure.textContent);
        amount.title = value.row.title;
        amount.prepend(icon("rolimons"));
        content.append(amount);
      }
      if (indicators || projected) content.append(itemBadges(meta, dailySales, { indicators, projected }));
      if (sales) content.append(actions);
      panel.append(content);
    }

    // A detail value row can still use the resolved RAP for its Best Price comparison.
    let resale;
    function getResale() {
      resale ??= request("resale", { item: target }).then((result) => {
        if (result?.status !== "ok") resale = null;
        if (item.rap == null && result?.rap != null) {
          updateRap(result.rap, result.checkedAt);
          onRap?.(result.rap);
        }
        return result;
      });
      return resale;
    }

    function updateRap(value, checkedAt, source = "Roblox") {
      if (value == null) return;
      rap.figure.textContent = format(value);
      rap.row.title = `Recent Average Price · ${source}`;
      if (checkedAt) rap.row.title += ` · checked ${new Date(checkedAt).toLocaleString()}`;
    }

    if (item.rap != null) updateRap(item.rap, item.checkedAt, item.rapSource);
    else if (item.limited && !cardOverlay && (sales || (showValue && onRap))) void getResale();
    if (!sales) return panel;

    const preview = element("section", "roxol-sales-preview");
    preview.setAttribute("popover", "auto");
    preview.setAttribute("aria-label", "Recent sales");
    preview.id = `roxol-sales-${++salesPreviewCount}`;
    history.setAttribute("aria-controls", preview.id);
    const previewMetrics = element("dl", "roxol-metrics");
    previewMetrics.append(rap.row);
    const previewBody = element("div", "roxol-preview-body");
    const more = button("Full sales history");
    const footer = element("div", "roxol-actions roxol-preview-footer");
    footer.append(more, card ? provider : rolimonsSalesLink(item));
    preview.append(element("h3", "", "Recent sales"), previewMetrics);
    if (card && (indicators || projected)) preview.append(itemBadges(meta, dailySales, { indicators, projected }));
    preview.append(previewBody, footer);
    (cardOverlay || panel).append(preview);
    if (card) {
      panel.addEventListener("click", (event) => {
        if (event.target.closest("button, a")) event.stopPropagation();
      });
    }
    let pendingSales;
    function getSales() {
      pendingSales ??= request("sales", { item: target }).finally(() => { pendingSales = null; });
      return pendingSales;
    }

    connectSalesPreview(history, preview, previewBody, getSales, { card, value: meta?.value, getBestPrice, target });
    more.addEventListener("click", () => {
      const restoreFocus = preview.contains(document.activeElement);
      preview.hidePopover();
      if (restoreFocus) history.focus({ preventScroll: true });
      const body = showDialog(item.name ? `${item.name} sales history` : "Sales history");
      body.parentElement.classList.add("roxol-sales-dialog");
      body.append(rolimonsSalesLink(item));
      const filters = element("div", "roxol-actions roxol-sales-filters");
      const tracked = button("Rolimon’s tracked sales");
      const daily = button("Roblox daily prices");
      filters.append(tracked, daily);
      const results = element("div", "roxol-sales-results");
      results.setAttribute("aria-live", "polite");
      body.append(filters, results);
      let loadVersion = 0;

      async function show(isTracked) {
        const version = ++loadVersion;
        tracked.setAttribute("aria-pressed", String(isTracked));
        daily.setAttribute("aria-pressed", String(!isTracked));
        results.replaceChildren(element("p", "roxol-note", isTracked ? "Loading Rolimon’s sales…" : "Loading Roblox daily prices…"));
        const result = await (isTracked ? getSales() : getResale());
        if (!body.isConnected || version !== loadVersion) return;
        if (isTracked) showSaleGrid(results, result);
        else showDaily(results, result);
      }

      tracked.addEventListener("click", () => { void show(true); });
      daily.addEventListener("click", () => { void show(false); });
      void show(true);
    });

    return panel;
  }

  const cardPriceSelector = ".item-card-price, [data-testid='item-price'], .item-price, .item-value";
  const thumbnailSelector = ".item-card-thumb-container, .trade-request-item-thumbnail, .item-thumbnail, .thumbnail-2d-container, thumbnail-2d";
  // Vaulted until the copy ID control can reliably copy the correct ID.
  const showCardCopyId = false;

  function mountCard(card, item, {
    nativeLabel = "Roblox RAP", priceIsRap = false, linkValue = false,
    showValue = true, indicators = true, sales = true, projected = true,
  } = {}) {
    const image = card.querySelector("img");
    const thumbnail = card.querySelector(thumbnailSelector) || (image?.parentElement !== card ? image?.parentElement : null);
    if (!thumbnail) return null;
    const price = card.querySelector(cardPriceSelector);
    const priceText = price?.textContent;
    const name = card.querySelector(".item-card-name, .item-name, [data-testid='item-name']");
    const nativePrice = showValue && price && (priceIsRap ? /^\s*\d+(?:[,.'’\s]\d{3})*\s*$/.test(priceText)
      : /\d|^\s*free\s*$/i.test(priceText));
    const overlay = element("div", "roxol-market roxol-card-overlay");
    const state = cardState(item.rolimons, { indicators, projected });
    if (state) overlay.append(state);
    overlay.hidden = !state && !indicators && !sales && !showCardCopyId;
    overlay.classList.toggle("roxol-card-without-sales", !sales);
    if (showCardCopyId && item.copyId) {
      const label = item.serial ? `#${item.serial}` : /^\d+$/.test(item.copyId) ? `ID ${item.copyId}` : "Copy ID";
      overlay.append(cardBadge(`${item.serial ? `Serial #${item.serial}\n` : ""}Copy ID: ${item.copyId}`, null, "copy", label));
    }
    const panel = itemPanel(item, {
      card: true, cardOverlay: overlay, nativeLabel: nativePrice ? null : nativeLabel, linkValue,
      showValue, indicators, sales, projected,
    });
    const anchor = price || name;
    const nativeWrapper = linkValue && (anchor || card).closest("a, button");
    if (nativeWrapper) nativeWrapper.after(panel);
    else if (anchor && !thumbnail.contains(anchor)) anchor.after(panel);
    else card.append(panel);
    // Roblox uses clickable tiles in the picker and sometimes wraps the thumbnail in a link.
    overlay.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target.closest("button")) event.preventDefault();
    });
    overlay.addEventListener("pointerdown", (event) => event.stopPropagation());
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    });
    const link = thumbnail.closest("a[href]");
    const anchored = link && CSS.supports("top", "anchor(top)");
    const oldAnchor = thumbnail.style.getPropertyValue("anchor-name");
    if (anchored) {
      const anchorName = `--roxol-thumbnail-${++cardAnchorCount}`;
      thumbnail.style.setProperty("anchor-name", anchorName);
      overlay.style.setProperty("position-anchor", anchorName);
      overlay.classList.add("roxol-card-anchored");
      link.after(overlay);
    } else {
      if (getComputedStyle(thumbnail).position === "static") thumbnail.classList.add("roxol-card-relative");
      thumbnail.append(overlay);
    }
    if (showCardCopyId && thumbnail.querySelector(".limited-icon-container, .icon-label-limited, .icon-label-limited-unique")) {
      overlay.classList.add("roxol-card-with-limited-badge");
    }
    const oldLabel = price?.getAttribute("aria-label");
    const oldRole = price?.getAttribute("role");
    if (nativePrice) {
      if (!oldRole && !price.matches("a, button")) price.setAttribute("role", "group");
      const label = priceIsRap ? nativeLabel : "Roblox asking price";
      const units = /\d/.test(priceText) ? " Robux" : "";
      price.setAttribute("aria-label", `${label}: ${priceText.trim()}${units}`);
    }
    return {
      valid: () => panel.isConnected && (nativeWrapper
        ? nativeWrapper.isConnected && panel.parentElement === nativeWrapper.parentElement : card.contains(panel)) &&
        thumbnail.isConnected &&
        (anchored ? overlay.previousElementSibling === link : overlay.parentElement === thumbnail) &&
        card.querySelector(cardPriceSelector) === price && price?.textContent === priceText,
      remove() {
        overlay.remove();
        panel.remove();
        thumbnail.classList.remove("roxol-card-relative");
        if (anchored) thumbnail.style.setProperty("anchor-name", oldAnchor);
        if (nativePrice) {
          if (oldLabel == null) price.removeAttribute("aria-label");
          else price.setAttribute("aria-label", oldLabel);
          if (!oldRole) price.removeAttribute("role");
        }
      },
    };
  }

  function inventoryView(model, loadPage, badges, itemOptions) {
    const body = showDialog("Collectible inventory");
    const totals = element("div", "roxol-inventory-totals");
    const rap = element("strong");
    const value = element("strong");
    totals.append(rap, value);
    const status = element("p", "roxol-note");
    status.setAttribute("role", "status");
    const { table, rows } = makeTable(["Item", "Serial"]);
    const next = button("Load more");
    next.classList.add("roxol-load-more");
    body.append(totals, status, table, next, badges);
    let displayed = 0;

    function paint() {
      if (!body.isConnected) return;
      const rapSummary = model.summary(false);
      const valueSummary = model.summary(true);
      rap.textContent = rapSummary.text;
      value.textContent = valueSummary.text;
      status.textContent = model.description() + rapSummary.description + valueSummary.description;
      table.hidden = !model.items.length;
      next.hidden = !model.canLoad();
      next.disabled = model.loading;
      next.textContent = model.loading ? "Loading…" : model.failed ? "Try again" : "Load more";
      for (const item of model.items.slice(displayed)) {
        const row = rows.insertRow();
        const name = row.insertCell();
        name.append(link(item.name, robloxItemUrl(item), true));
        if (itemOptions.showValue || itemOptions.indicators || itemOptions.sales) {
          name.append(itemPanel(item, { ...itemOptions, card: true }));
        }
        row.insertCell().textContent = item.serial ? `#${item.serial}` : "—";
      }
      displayed = model.items.length;
    }

    next.addEventListener("click", () => { void loadPage(); });
    paint();
    return paint;
  }

  return { element, link, titleLink, button, icon, metric, format, tradingFigure, tradingStat, request, downloadJson, rolimonsItemUrl, itemPanel, mountCard, cardValue, cardPriceSelector, bestPriceDeals, inventoryView, showPlayerBadges, showDialog, closeDialog };
})();
