(() => {
  // Match the Trades list and localized lists. The manifest match patterns
  // are broader because Chromium match patterns cannot check locale syntax.
  const tradesListPath = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/trades\/?$/i;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id === chrome.runtime.id && message?.type === "roxol:trade-page-status") {
      sendResponse({ ready: tradesListPath.test(location.pathname) });
    }
  });

  const { idOf, amount, routeOf, keyOf, cardCopy, cardTarget } = RoxolTargets;
  if (routeOf(location.href)?.page !== "trades") return;
  const { tradeRow, selectedRow, detailOffer, requestOffer, detailCard, requestCard, pickerCard, cardsIn } = RoxolTrades;
  const ui = RoxolMarketUI;
  const nativeSelector = `.trade-row-list, ${detailOffer}, ${requestOffer}, .trade-inventory-panel`;
  const signed = new Intl.NumberFormat(undefined, { signDisplay: "exceptZero" });
  const percent = new Intl.NumberFormat(undefined, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 1 });
  const demandFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const itemRequests = new Map();
  const widgets = new Map();
  const offerTotals = new Map();
  const tradeRequests = new Map();
  const rowSummaries = new Map();
  const summaryMetrics = [["RAP", "robux"], ["Value", "rolimons"]];
  let pendingRows = 0;
  let selection;
  let priorDetail;
  let comparison;
  let view;
  let preferences;

  function nativeData(node) {
    let data;
    const read = (event) => {
      try { data = JSON.parse(event.detail); } catch {}
    };
    node.addEventListener("roxol:native-trade", read);
    // The bridge responds synchronously. Remove the listener even when Roblox has no data.
    node.dispatchEvent(new Event("roxol:read-native-trade", { bubbles: true }));
    node.removeEventListener("roxol:native-trade", read);
    return data;
  }

  function nativeAmount(text) {
    const value = text?.trim();
    if (!/^\d+$|^\d{1,3}(?:[,.'’\s]\d{3})+$/.test(value ?? "")) return null;
    return amount(Number(value.replace(/\D/g, "")));
  }

  function readCard(card) {
    const native = nativeData(card);
    const item = card.querySelector("a[href*='/catalog/'], a[href*='/bundles/']") || card.closest("a[href]");
    const route = routeOf(item?.href);
    const target = route?.page === "detail" ? { kind: route.kind, id: route.id } : cardTarget(card) ?? native?.target;
    const copy = cardCopy(card);
    const price = card.querySelector(ui.cardPriceSelector);
    const rap = nativeAmount(price?.textContent) ?? native?.rap ?? null;
    return {
      card, target, rap,
      instanceId: copy.instanceId ?? native?.instanceId,
      userAssetId: copy.userAssetId ?? native?.userAssetId,
      serial: copy.serial ?? native?.serial,
    };
  }

  function readOffer(offer, isForm) {
    const heading = offer.querySelector(".trade-list-detail-offer-header, h2");
    const robuxInput = offer.querySelector('input[name="robux"]');
    const net = offer.querySelector(".robux-line .text-label.robux-line-value, .text-label.robux-line-value");
    const cards = cardsIn(offer, isForm ? requestCard : detailCard).map(readCard);
    return {
      offer, cards,
      tradeId: isForm ? null : idOf(nativeData(offer)),
      receive: /your request|would have received|would receive|will receive|received/i.test(heading?.textContent ?? ""),
      net: net && !net.closest(".ng-hide, [hidden]") ? nativeAmount(net.textContent) : undefined,
      gross: robuxInput ? (robuxInput.value.trim() === "" ? 0 : nativeAmount(robuxInput.value)) : null,
      hasInput: !!robuxInput,
    };
  }

  function offerSignature({ cards, tradeId, net, gross, hasInput, receive }) {
    return JSON.stringify([tradeId, net, gross, hasInput, receive,
      cards.map(({ card, ...data }) => data)]);
  }

  function readView() {
    const visible = (selector) => [...document.querySelectorAll(selector)].filter((element) =>
      !element.closest(".ng-hide, [hidden], [aria-hidden='true']") && element.getClientRects().length > 0);
    const form = visible(requestOffer);
    const detail = visible(detailOffer);
    const isForm = form.length === 2;
    const elements = isForm ? form : detail;
    const row = document.querySelector(selectedRow);
    const id = row && !isForm ? idOf(nativeData(row)) : null;
    const displayed = elements.length === 2 ? elements.map((offer) => readOffer(offer, isForm)) : [];
    const offers = displayed[0]?.receive && !displayed[1]?.receive ? displayed.toReversed() : displayed;
    const picker = isForm ? visible(pickerCard).map(readCard) : [];
    return { isForm, id, row: isForm ? null : row, offers, displayed, picker, signatures: offers.map(offerSignature) };
  }

  function sameOffers(a, b) {
    return a?.offers.length === b.offers.length && b.offers.every(({ offer, cards }, side) =>
      a.offers[side].offer === offer && a.signatures[side] === b.signatures[side] &&
      cards.every(({ card }, index) => a.offers[side].cards[index]?.card === card));
  }

  function startSelection(next) {
    const request = { id: next.id, row: next.row, previous: priorDetail };
    selection = request;
    if (!request.id) return;
    loadTrade(request.id).then((data) => {
      if (selection !== request) return;
      request.data = data;
      scan();
    });
  }

  function loadTrade(id) {
    const cached = tradeRequests.get(id);
    if (cached && cached.expires > Date.now()) return cached.result;
    const result = chrome.runtime.sendMessage({ type: "roxol:trade-detail", id }).catch(() => null);
    const entry = { result, expires: Infinity };
    tradeRequests.delete(id);
    tradeRequests.set(id, entry);
    if (tradeRequests.size > 100) tradeRequests.delete(tradeRequests.keys().next().value);
    void result.then((data) => { entry.expires = Date.now() + (data ? 60_000 : 10_000); });
    return result;
  }

  function loadMetadata(items) {
    const missing = new Map();
    for (const { target } of items) {
      if (!target) continue;
      const key = keyOf(target);
      if (!itemRequests.has(key)) missing.set(key, target);
    }
    const entries = [...missing];
    for (let offset = 0; offset < entries.length; offset += 40) {
      const batch = entries.slice(offset, offset + 40);
      const result = ui.request("items", { items: batch.map(([, target]) => target) });
      for (const [key] of batch) itemRequests.set(key, { pending: true });
      void result.then((data) => {
        for (const [key] of batch) itemRequests.set(key, { data: data?.[key] });
        scan();
      });
    }
  }

  function metadata(target) {
    return target && itemRequests.get(keyOf(target));
  }

  function instanceMatches(card, copy) {
    return (card.instanceId && card.instanceId === copy.instanceId) ||
      (card.userAssetId && card.userAssetId === copy.userAssetId);
  }

  function offerItems(native, api) {
    if (!api.items || native.length !== api.items.length) return null;
    const remaining = new Set(api.items);
    const matches = new Map();
    // Resolve exact copies first. A matching catalog link alone cannot identify duplicate copies.
    for (const card of native) {
      const exact = [...remaining].filter((copy) => instanceMatches(card, copy));
      if (exact.length !== 1) continue;
      const copy = exact[0];
      if (card.target && copy.target && keyOf(card.target) !== keyOf(copy.target)) return null;
      remaining.delete(copy);
      matches.set(card, { copy, verified: true });
    }
    for (const card of native) {
      if (matches.has(card)) continue;
      const candidates = [...remaining].filter((copy) => card.target && copy.target &&
        keyOf(card.target) === keyOf(copy.target) &&
        !(card.instanceId && copy.instanceId && card.instanceId !== copy.instanceId) &&
        !(card.userAssetId && copy.userAssetId && card.userAssetId !== copy.userAssetId));
      if (!candidates.length) return null;
      const copy = candidates[0];
      remaining.delete(copy);
      matches.set(card, { copy, verified: candidates.length === 1 &&
        ![...matches.values()].some((match) => !match.verified && match.copy.target &&
          keyOf(match.copy.target) === keyOf(copy.target)) });
    }
    const cards = native.map((card) => {
      const { copy, verified } = matches.get(card);
      return {
        ...card, target: copy.target ?? card.target,
        rap: card.rap ?? (verified ? copy.rap : null),
        instanceId: card.instanceId ?? (verified ? copy.instanceId : null),
        userAssetId: card.userAssetId ?? (verified ? copy.userAssetId : null),
        serial: card.serial ?? (verified ? copy.serial : null),
      };
    });
    const prices = native.map((card, index) => {
      const { copy, verified } = matches.get(card);
      const target = cards[index].target;
      if (verified) return { target, rap: cards[index].rap };
      const group = native.filter((candidate) => !matches.get(candidate).verified &&
        keyOf(candidate.target) === keyOf(target));
      // Sum a complete set from one source when the tile-to-copy order is unknown.
      const rap = group.every((candidate) => candidate.rap != null) ? card.rap : copy.rap;
      return { target, rap };
    });
    return { cards, prices };
  }

  function detailOffers(next) {
    if (!next.id || !selection.data || next.offers.length !== 2) return null;
    if (next.offers.some(({ tradeId }) => tradeId && tradeId !== next.id)) return null;
    const previous = selection.previous;
    if (previous && previous.id !== next.id && sameOffers(previous, next) &&
        !next.offers.some(({ tradeId }) => tradeId === next.id)) return null;
    const items = next.offers.map(({ cards }, side) => offerItems(cards, selection.data[side]));
    if (items.some((item) => !item)) return null;
    return items.map((items, side) => {
      const gross = selection.data[side].robux;
      const net = next.offers[side].net;
      // Native detail rows show post-tax Robux. Use the API gross on the give side.
      const robux = side === 0 ? gross : net ?? netRobux(gross);
      return { ...items, robux };
    });
  }

  function formOffers(offers) {
    if (offers.length !== 2) return null;
    return offers.map(({ cards, gross, hasInput, net }, side) => ({
      cards, prices: cards,
      robux: side === 1
        ? (hasInput ? netRobux(gross) : net === undefined ? 0 : net)
        : (hasInput ? gross : net === undefined || net === 0 ? 0 : null),
    }));
  }

  function netRobux(gross) {
    return gross == null ? null : Math.round(gross * 0.7);
  }

  function total({ prices, robux }, metric) {
    if (robux == null) return null;
    let sum = BigInt(robux);
    for (const item of prices) {
      const meta = metadata(item.target);
      if (metric === "Value" && meta?.pending) return null;
      const figure = metric === "RAP" ? item.rap : ui.cardValue({ rap: item.rap, rolimons: meta?.data?.rolimons }).amount;
      if (figure == null) return null;
      sum += BigInt(figure);
    }
    return sum;
  }

  function rowOffers(data) {
    return data.map(({ items, robux }, side) => ({
      prices: items.map((item) => ({ ...item, rap: item.rap ?? metadata(item.target)?.data?.rap ?? null })),
      robux: side === 0 ? robux : netRobux(robux),
    }));
  }

  function renderRowSummary(row, state) {
    if (!state.data?.every(({ items }) => Array.isArray(items))) return;
    const offers = rowOffers(state.data);
    const totals = summaryMetrics.map(([metric]) => offers.map((offer) => total(offer, metric)));
    if (totals.every((pair) => pair.every((figure) => figure == null))) return;
    const signature = totals.map((pair) => pair.join("|")).join("/");
    if (state.signature !== signature) {
      const summary = ui.element("span", "roxol-market roxol-trade-row-summary");
      for (const [index, [metric, asset]] of summaryMetrics.entries()) {
        const [give, receive] = totals[index];
        const pair = ui.element("span", "roxol-trade-row-pair");
        const label = metric === "Value" ? "Rolimon's value" : "RAP";
        const direction = give == null || receive == null ? "unknown" : receive > give ? "up" : receive < give ? "down" : "flat";
        pair.dataset.direction = direction;
        pair.title = `${label}: Give ${ui.format(give)} · Receive ${ui.format(receive)}`;
        pair.setAttribute("role", "img");
        pair.setAttribute("aria-label", pair.title);
        pair.append(ui.icon(asset));
        for (const figure of [give, receive]) {
          pair.append(ui.element("span", "roxol-number", figure == null ? "—" : ui.format(figure)));
        }
        summary.append(pair);
      }
      state.summary?.remove();
      state.summary = summary;
      state.signature = signature;
    }
    if (state.summary.parentElement !== row) row.append(state.summary);
  }

  function scanRows(next) {
    const active = new Map();
    if (tradesListPath.test(location.pathname) && !next.isForm) {
      for (const row of document.querySelectorAll(tradeRow)) {
        if (row.closest(".ng-hide, [hidden], [aria-hidden='true']") || !row.getClientRects().length) continue;
        const id = row === next.row ? next.id : idOf(nativeData(row));
        if (id) active.set(row, id);
      }
    }
    for (const [row, state] of rowSummaries) {
      if (active.get(row) === state.id) continue;
      state.summary?.remove();
      rowSummaries.delete(row);
    }
    for (const [row, id] of active) {
      if (pendingRows >= 3) break;
      if (rowSummaries.has(row)) continue;
      const state = { id };
      rowSummaries.set(row, state);
      pendingRows++;
      void loadTrade(id).then((data) => {
        state.data = data;
        pendingRows--;
        scan();
      });
    }
    loadMetadata([...rowSummaries.values()].flatMap(({ data }) => data?.flatMap(({ items }) => items ?? []) ?? []));
    for (const [row, state] of rowSummaries) renderRowSummary(row, state);
  }

  function offerDemand({ prices }) {
    let sum = 0;
    let rated = 0;
    for (const { target } of prices) {
      const meta = metadata(target);
      if (meta?.pending) return null;
      const rating = meta?.data?.rolimons?.demandRating;
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) continue;
      sum += rating;
      rated++;
    }
    return { average: rated ? sum / rated : null, rated, count: prices.length };
  }

  function offerTotalRow(line, amount, title, figure) {
    const nativeLabel = [...line.children].find((child) => !child.contains(amount));
    const row = ui.element(line.localName, "robux-line roxol-market roxol-trade-total");
    const label = ui.element(nativeLabel?.localName ?? "span", nativeLabel?.className ?? "text-label", title);
    const value = ui.element(amount.localName, amount.className);
    value.append(figure);
    row.append(label, value);
    return row;
  }

  function renderOfferTotals(offers, values, demands) {
    const active = new Set();
    for (const [side, { offer }] of offers.entries()) {
      const rap = offer.querySelector(".robux-line:not(.roxol-market, .ng-hide, [ng-show]) .robux-line-amount .robux-line-value.text-robux-lg");
      if (!rap) continue;
      active.add(rap);
      const line = rap.closest(".robux-line");
      let widget = offerTotals.get(rap);
      if (!widget) {
        const suffix = ui.element("span", "roxol-market roxol-trade-rap-label", " (RAP)");
        const valueFigure = ui.element("span", "roxol-trade-total-figure robux-line-value text-robux-lg");
        const number = ui.element("span", "");
        valueFigure.append(ui.icon("rolimons"), number);
        const demandFigure = ui.element("span", "roxol-trade-total-figure robux-line-value text-robux-lg");
        const bars = ui.element("span", "roxol-trade-demand-bars");
        bars.setAttribute("aria-hidden", "true");
        for (let bar = 1; bar <= 5; bar++) bars.append(ui.element("span", ""));
        const score = ui.element("span", "roxol-number");
        demandFigure.append(bars, score);
        const amount = rap.closest(".robux-line-amount");
        const valueRow = offerTotalRow(line, amount, "Rolimon’s Value:", valueFigure);
        const demandRow = offerTotalRow(line, amount, "Demand:", demandFigure);
        widget = { suffix, valueRow, number, demandRow, bars, score };
        offerTotals.set(rap, widget);
      }
      const value = values?.[side];
      widget.valueRow.hidden = value == null;
      const formatted = value == null ? "" : ui.format(value);
      if (widget.number.textContent !== formatted) widget.number.textContent = formatted;
      const demand = demands?.[side];
      widget.demandRow.hidden = !demand;
      if (demand) {
        const { average, rated, count } = demand;
        const score = average == null ? "—" : `${demandFormat.format(average)}/${demandFormat.format(5)}`;
        const description = average == null ? "No items with a Rolimon’s demand rating" :
          `Average Rolimon’s demand across ${rated} of ${count} item copies`;
        if (widget.score.textContent !== score) widget.score.textContent = score;
        widget.demandRow.title = description;
        for (const [index, bar] of [...widget.bars.children].entries()) {
          const fill = Math.min(1, Math.max(0, (average ?? 0) - index));
          bar.style.setProperty("--roxol-demand-fill", `${fill * 100}%`);
        }
      }
      if (rap.nextElementSibling !== widget.suffix) rap.after(widget.suffix);
      if (line.nextElementSibling !== widget.valueRow || widget.valueRow.nextElementSibling !== widget.demandRow) {
        line.after(widget.valueRow, widget.demandRow);
      }
    }
    for (const [rap, { suffix, valueRow, demandRow }] of offerTotals) {
      if (active.has(rap)) continue;
      suffix.remove();
      valueRow.remove();
      demandRow.remove();
      offerTotals.delete(rap);
    }
  }

  function comparisonChip(label, give, receive) {
    const chip = ui.element("span", "roxol-trade-chip");
    const caption = ui.element("span", "roxol-trade-chip-label", label);
    caption.prepend(ui.icon(label === "RAP" ? "robux" : "rolimons"));
    chip.append(caption);
    if (give == null || receive == null) {
      chip.append(ui.element("span", "", "Unavailable"));
      return chip;
    }
    const delta = receive - give;
    const change = give > 0n ? ` (${percent.format(Number(delta) / Number(give))})` : "";
    const figure = ui.element("strong", "roxol-number", `${signed.format(delta)}${change}`);
    figure.dataset.direction = delta > 0n ? "up" : delta < 0n ? "down" : "flat";
    chip.append(figure);
    chip.title = `Give ${ui.format(give)} · Receive ${ui.format(receive)}`;
    return chip;
  }

  function mountComparison(next, offers, values) {
    const [first, second] = next.displayed;
    if (!comparison) {
      comparison = ui.element("div", "roxol-market roxol-trade-comparison");
      comparison.setAttribute("role", "group");
      comparison.setAttribute("aria-label", "Trade comparison, receive minus give");
      comparison.setAttribute("aria-live", "polite");
    }
    const totals = [["RAP", ...offers.map((offer) => total(offer, "RAP"))], ["Value", ...values]];
    const signature = totals.map((row) => row.join("|")).join("/");
    if (comparison.dataset.totals !== signature) {
      for (const chip of comparison.querySelectorAll(".roxol-trade-chip")) chip.remove();
      comparison.prepend(...totals.map((row) => comparisonChip(...row)));
      comparison.dataset.totals = signature;
    }
    if (next.isForm) {
      if (comparison.previousElementSibling !== first.offer) first.offer.after(comparison);
    } else if (second.offer.firstElementChild !== comparison) {
      second.offer.prepend(comparison);
    }
  }

  function renderCards(items) {
    const byCard = new Map();
    for (const { card, target, rap, instanceId, userAssetId, serial } of items) {
      const meta = metadata(target)?.data;
      if (!target) continue;
      if (!preferences.tradeItems && !(preferences.tradeProjected && meta?.rolimons?.projected)) continue;
      byCard.set(card, { ...target, ...meta, limited: true, rap, rapSource: "Roblox", copyId: instanceId || userAssetId, serial });
    }
    for (const [card, state] of widgets) {
      const item = byCard.get(card);
      if (item && state.signature === JSON.stringify(item) && state.widget.valid()) continue;
      state.widget.remove();
      widgets.delete(card);
    }
    for (const [card, item] of byCard) {
      if (widgets.has(card)) continue;
      const widget = ui.mountCard(card, item, {
        priceIsRap: true, linkValue: true,
        showValue: preferences.tradeItems, indicators: preferences.tradeItems,
        sales: preferences.tradeItems, projected: preferences.tradeProjected,
      });
      if (widget) widgets.set(card, { widget, signature: JSON.stringify(item) });
    }
  }

  function scan() {
    if (!preferences?.enabled ||
        !(preferences.tradeComparisons || preferences.tradeItems || preferences.tradeProjected)) return;
    const next = readView();
    const changedSelection = selection?.id !== next.id || selection?.row !== next.row;
    if (changedSelection || !sameOffers(view, next) || view?.isForm !== next.isForm) {
      comparison?.remove();
      comparison = null;
      if (changedSelection) ui.closeDialog();
    }
    if (changedSelection) startSelection(next);
    view = next;
    const offers = next.isForm ? formOffers(next.offers) : detailOffers(next);
    if (!next.isForm && next.id && next.offers.length &&
        (!selection.previous || offers || selection.previous.id === next.id)) priorDetail = next;
    const cards = [...(offers?.flatMap((offer) => offer.cards) ?? []), ...next.picker];
    loadMetadata([...cards, ...(offers?.flatMap((offer) => offer.prices) ?? [])]);
    renderCards(cards);
    if (preferences.tradeComparisons) {
      const values = offers?.map((offer) => total(offer, "Value"));
      renderOfferTotals(next.offers, values, offers?.map(offerDemand));
      if (offers) mountComparison(next, offers, values);
      else {
        comparison?.remove();
        comparison = null;
      }
      scanRows(next);
    }
  }

  RoxolPreferences.watch((next) => {
    const changed = (key) => next[key] !== preferences?.[key];
    const enabled = changed("enabled");
    const cards = changed("tradeItems") || changed("tradeProjected");
    const totals = changed("tradeComparisons");
    preferences = next;
    if (enabled || cards) {
      ui.closeDialog();
      renderCards([]);
    }
    if (enabled || totals) {
      renderOfferTotals([]);
      comparison?.remove();
      comparison = null;
      for (const { summary } of rowSummaries.values()) summary?.remove();
      rowSummaries.clear();
    }
    if (!next.enabled) {
      selection = priorDetail = view = null;
      return;
    }
    if (enabled || cards || totals) scan();
  });

  function touchesTrade({ target, addedNodes, removedNodes }) {
    const node = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (node?.closest(".roxol-market")) return false;
    const children = [...addedNodes, ...removedNodes];
    if (children.length && children.every((child) => child instanceof Element && child.matches(".roxol-market"))) return false;
    return node?.closest(".trade-row-list") || node?.closest(nativeSelector) ||
      children.some((child) => child instanceof Element &&
        !child.matches(".roxol-market") && (child.matches(nativeSelector) || child.querySelector(nativeSelector)));
  }

  new MutationObserver((changes) => {
    if (changes.some(touchesTrade)) scan();
  }).observe(document.body, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["class", "hidden", "aria-hidden", "href", "value", "data-trade-id", "nrutradeid", "data-nte-trade-id", "data-collectibleiteminstanceid",
      "data-collectible-item-instance-id", "data-user-asset-id", "data-userassetid", "user-asset-id",
      "data-serial-number", "data-serialnumber",
      "data-asset-id", "data-bundle-id", "data-item-id", "data-item-type"],
  });
  for (const event of ["input", "change"]) {
    document.addEventListener(event, ({ target }) => {
      if (target.matches?.('input[name="robux"]') && target.closest(requestOffer)) scan();
    });
  }
  window.addEventListener("popstate", scan);
  window.navigation?.addEventListener("currententrychange", scan);
})();
