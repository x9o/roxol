const RoxolOverpaySampling = (() => {
  const pageSize = 50;
  const rawCap = 500;
  const recentDays = 7;

  function summarizeSample({ assetId, records, reason, checkedAt, historyFailure, now, feed }) {
    const { itemPreview, currentSample, isolatedSide, unusualComposition } = RoxolItemOverpay;
    const cutoff = now - recentDays * 86_400_000;
    const seen = new Set();
    const exclusions = {};
    const eligible = [];
    const audit = records.map(({ id, firstObservedAt, trade, rejectedTrade, invalidReason }) => {
      const row = { id, firstObservedAt, trade: trade ?? rejectedTrade ?? null, exclusion: null };
      if (Date.parse(firstObservedAt) <= cutoff) row.exclusion = "outside-window";
      else if (!trade) row.exclusion = invalidReason ?? "invalid-source-record";
      else if (seen.has(id)) row.exclusion = "duplicate-trade";
      else {
        seen.add(id);
        const { from, through, valid } = RoxolTradeValuations.observationWindow(trade);
        const sides = [trade.sideA, trade.sideB];
        const isolated = isolatedSide(sides, assetId);
        row.exclusion = !valid || through > now ? "invalid-observation-time" :
          from <= cutoff ? "outside-window" : unusualComposition(sides) ??
          (isolated < 0 ? "target-bundled" : null);
        if (!row.exclusion) {
          row.sample = currentSample(trade, isolated, from, feed);
          eligible.push(row);
        }
      }
      if (row.exclusion) exclusions[row.exclusion] = (exclusions[row.exclusion] ?? 0) + 1;
      return row;
    });

    return {
      status: "ok", pricingSource: "rolimons-itemdetails", asOf: new Date(now).toISOString(),
      pricedAt: feed?.values().next().value?.checkedAt ?? null,
      fromExclusive: new Date(cutoff).toISOString(), checkedAt: checkedAt ?? null,
      ...(historyFailure ? { partial: true, historyFailure } : { reason }),
      audit, exclusions, groups: itemPreview(eligible, assetId, now),
    };
  }

  async function sampleItem({ assetId, previous, readPage, feed, now = Date.now() }) {
    const cutoff = now - recentDays * 86_400_000;
    const records = [];
    let reason = "cap";
    for (let page = 1; page <= rawCap / pageSize; page++) {
      const history = await readPage(page, pageSize).catch((error) => ({ message: error.message }));
      if (history?.status !== "ok") {
        const historyFailure = { page, httpStatus: history?.httpStatus ?? null, message: history?.message ?? null };
        if (records.length) return summarizeSample({ assetId, now, records, checkedAt: now, historyFailure, feed: await feed });
        if (!previous?.records.length) return { status: "unavailable", historyFailure };
        return { ...summarizeSample({ ...previous, assetId, now, historyFailure, feed: await feed }), cachedFallback: true };
      }
      records.push(...history.records);
      if (history.records.some(({ firstObservedAt }) => Date.parse(firstObservedAt) <= cutoff)) {
        reason = "date";
        break;
      }
      if (page >= history.pages || records.length >= history.total) {
        reason = "end";
        break;
      }
    }
    const saved = { assetId, records, reason, checkedAt: now };
    return { ...summarizeSample({ ...saved, now, feed: await feed }), saved };
  }

  return { sampleItem, summarizeSample };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RoxolOverpaySampling;
