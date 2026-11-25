(() => {
  // The isolated world cannot read Roblox's Angular scopes or React props.
  // Return only row identities and normalized card fields, without mutating Roblox state.
  const { idOf } = RoxolTargets;
  const { selectedRow, detailOffer, requestOffer, detailCard, requestCard, pickerCard, itemOf } = RoxolTrades;

  function* reactProps(node, limit) {
    const key = Object.keys(node).find((name) => name.startsWith("__reactFiber$"));
    let fiber = key && node[key];
    if (fiber?.alternate) {
      let root = fiber;
      while (root.return) root = root.return;
      if (root.stateNode?.current === root.alternate) fiber = fiber.alternate;
    }
    for (let depth = 0; fiber && depth < limit; depth++, fiber = fiber.return) {
      if (fiber.memoizedProps) yield fiber.memoizedProps;
    }
  }

  function scopeOf(node) {
    const wrapper = window.angular?.element(node);
    return wrapper?.scope?.() || wrapper?.isolateScope?.();
  }

  function tradeId(trade) {
    if (trade?.user || trade?.status || trade?.offers || trade?.participantAOffer || trade?.created || trade?.createdAt) {
      return idOf(trade.id ?? trade.tradeId ?? trade.trade_id);
    }
    return null;
  }

  function rowId(row) {
    const scope = scopeOf(row);
    for (const candidate of [scope, scope?.$parent, scope?.$parent?.$parent]) {
      const id = idOf(candidate?.trade?.id ?? candidate?.trade?.tradeId);
      if (id) return id;
    }
    for (const props of reactProps(row, 30)) {
      for (const candidate of [props.trade, props.tradeData, props.tradeInfo, props.data, props.item, props.value, props.children?.props?.trade]) {
        const id = tradeId(candidate);
        if (id) return id;
      }
    }
    return idOf(row.getAttribute("data-trade-id") || row.getAttribute("nruTradeId") || row.getAttribute("data-nte-trade-id"));
  }

  function offerTradeId(offer) {
    for (const props of reactProps(offer, 16)) {
      const detail = props.tradeDetail ?? props.tradeDetails ?? props.trade;
      if (!detail?.offers && !detail?.participantAOffer) continue;
      const id = tradeId(detail);
      if (id) return id;
    }
    return idOf(offer.getAttribute("data-trade-id"));
  }

  function cardItem(card) {
    for (const props of reactProps(card, 12)) {
      const item = itemOf(props.item ?? props.tradableItem ?? props.slot?.item);
      if (item.target || item.instanceId || item.userAssetId) return item;
    }
    const scope = scopeOf(card);
    return itemOf(scope?.tradableItem ?? scope?.item ?? scope?.slot?.item);
  }

  document.addEventListener("roxol:read-native-trade", (event) => {
    const node = event.target;
    if (!(node instanceof Element)) return;
    let result;
    try {
      if (node.matches(selectedRow)) result = rowId(node);
      else if (node.matches(detailOffer)) result = offerTradeId(node);
      else if (node.matches(detailCard + ", " + requestCard + ", " + pickerCard) &&
        node.closest(`${detailOffer}, ${requestOffer}, .trade-inventory-panel`)) result = cardItem(node);
    } catch {
      return;
    }
    if (result != null) node.dispatchEvent(new CustomEvent("roxol:native-trade", { detail: JSON.stringify(result) }));
  });
})();
