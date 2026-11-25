const ROBLOX_TRADES_URL = "https://www.roblox.com/trades";

const RoxolTrades = (() => {
  const { idOf, targetOf, amount, copyIdOf } = RoxolTargets;
  const selectedRow = ".trade-row-list .trade-row.selected";
  const detailOffer = ".trade-list-detail-offer";
  const requestOffer = ".trade-request-window-offer";
  const detailCard = ".item-card-container, .trade-request-item:not(.blank-item):not(.draggable-border)";
  const requestCard = ".trade-request-item:not(.blank-item):not(.draggable-border), [ng-repeat='slot in offer.slots']";
  const pickerCard = ".trade-inventory-panel .item-card-container";

  function itemOf(item, legacyUserAsset = false) {
    const product = item?.item ?? item;
    const target = item?.itemTarget ?? product?.itemTarget;
    const kind = String(target?.itemType ?? item?.itemType ?? product?.itemType ??
      (item?.bundleId || product?.bundleId || item?.isBundle === true ? "bundle" : "asset")).toLowerCase();
    return {
      target: targetOf(kind, target?.targetId ?? item?.targetId ?? product?.targetId ??
        product?.bundleId ?? product?.assetId ?? product?.itemId ?? item?.asset?.id),
      rap: amount(item?.recentAveragePrice ?? item?.rap ?? product?.recentAveragePrice ?? product?.rap ?? item?.asset?.recentAveragePrice),
      instanceId: copyIdOf(item?.collectibleItemInstanceId ?? item?.collectibleItemInstance?.collectibleItemInstanceId ?? item?.collectibleItemInstance?.id),
      userAssetId: idOf(item?.userAssetId ?? item?.userAsset?.id ?? item?.userAsset?.userAssetId ??
        (legacyUserAsset ? item?.id : null)),
      serial: idOf(item?.serialNumber ?? item?.serial),
    };
  }

  function tradeOf(trade, selfId) {
    const offers = Array.isArray(trade?.offers) ? trade.offers : [trade?.participantAOffer, trade?.participantBOffer];
    const owner = (offer) => idOf(offer?.user?.id ?? offer?.userId ?? offer?.user?.userId ?? offer?.playerId);
    if (!selfId || offers.length !== 2 || offers.some((offer) => !owner(offer)) || owner(offers[0]) === owner(offers[1])) return null;
    const give = offers.find((offer) => owner(offer) === selfId);
    if (!give) return null;
    return [give, offers.find((offer) => offer !== give)].map((offer) => {
      const rows = offer.userAssets ?? offer.assets ?? offer.userItems ?? offer.items ?? offer.userCollectibles ?? offer.collectibles;
      return {
        robux: amount(offer.robux),
        items: Array.isArray(rows) ? rows.map((item) => itemOf(item, rows === offer.userAssets)) : null,
      };
    });
  }

  function cardsIn(offer, selector) {
    return [...offer.querySelectorAll(selector)].filter((card) =>
      !card.parentElement.closest(selector) && !card.matches(".blank-item, .draggable-border"));
  }

  return { selectedRow, detailOffer, requestOffer, detailCard, requestCard, pickerCard, itemOf, tradeOf, cardsIn };
})();
