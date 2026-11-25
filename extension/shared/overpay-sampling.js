const RoxolOverpaySampling = (() => {
  const pageSize = 50;
  const rawCap = 500;
  const target = 100;
  const retryPricingAfter = 5 * 60_000;

  async function sampleItem({ assetId, previous, readPage, readTradeProfile, now = Date.now() }) {
    const { itemPreview, previewSample, isolatedSide, unusualComposition, tradeGroup, recentDays } = RoxolItemOverpay;
    const cutoff = now - recentDays * 86_400_000;
    const records = [];
    const eligible = [];
    const seen = new Set();
    const counts = { swap: 0, downgrade: 0 };
    const previousById = new Map(previous.flatMap((row, index) => row.id ? [[row.id, index]] : []));
    let reason;

    async function consume(rows) {
      const pending = [];
      const batch = [];
      for (const incoming of rows) {
        if (records.length === rawCap) break;
        const { id, trade, firstObservedAt } = incoming;
        const prior = previous[previousById.get(id)];
        const row = prior === incoming ||
          (prior?.sample && JSON.stringify(prior.trade) === JSON.stringify(trade)) ? { ...prior } : { ...incoming };
        records.push(row);
        // RoUtility pages in decreasing order of its first observation timestamp.
        const first = Date.parse(firstObservedAt);
        if (first <= cutoff) {
          reason = "date";
          break;
        }
        if (!trade || seen.has(id)) continue;
        seen.add(id);
        const { from, through, valid } = RoxolTradeValuations.observationWindow(trade);
        const sides = [trade.sideA, trade.sideB];
        const isolated = isolatedSide(sides, assetId);
        if (!valid || from <= cutoff || through > now || isolated < 0 || unusualComposition(sides)) continue;
        batch.push({ row, group: tradeGroup(sides[1 - isolated]) });
        const retryAfter = row.pricingIncomplete ? 2 * 60_000 : retryPricingAfter;
        if (row.sample?.overpay == null && !(row.pricedAt > now - retryAfter)) {
          pending.push({ row, from, through });
        }
      }

      if (pending.length) {
        const needed = new Map();
        for (const { row, through } of pending) {
          const ids = new Set([...row.trade.sideA, ...row.trade.sideB].map(({ assetId: id }) => id));
          for (const id of ids) {
            const prior = needed.get(id);
            needed.set(id, { through: Math.max(through, prior?.through ?? 0), uses: (prior?.uses ?? 0) + 1 });
          }
        }
        const focalProfile = await readTradeProfile(assetId, needed.get(assetId).through);
        const profiles = new Map([[assetId, focalProfile]]);
        needed.delete(assetId);
        if (focalProfile) {
          const queue = [...needed.entries()].sort((a, b) => b[1].uses - a[1].uses).values();
          // Keep the shared market request queue available for other panels and tabs.
          await Promise.all(Array.from({ length: Math.min(8, needed.size) }, async () => {
            for (const [id, { through }] of queue) profiles.set(id, await readTradeProfile(id, through));
          }));
        }
        const valued = RoxolTradeValuations.resolveTrades(pending.map(({ row }) => row.trade), profiles);
        pending.forEach(({ row, from }, index) => {
          row.sample = previewSample(valued[index], assetId, from);
          row.pricedAt = now;
          row.pricingIncomplete = [...row.trade.sideA, ...row.trade.sideB].some(({ assetId: id }) => !profiles.get(id));
        });
      }

      for (const { row, group } of batch) {
        eligible.push(row);
        if (row.sample.overpay !== null) counts[group]++;
      }
      if (counts.swap >= target && counts.downgrade >= target) reason = "target";
      if (!reason && records.length === rawCap) reason = "cap";
    }

    let offset = 0;
    let reusedTail = false;
    for (let requests = 0; requests < rawCap / pageSize && !reason; requests++) {
      const page = Math.floor(offset / pageSize) + 1;
      const skip = offset % pageSize;
      const history = await readPage(page, pageSize).catch(() => null);
      if (history?.status !== "ok") {
        if (!offset && !previous.length) return { status: "unavailable" };
        if (!offset) {
          for (let index = 0; index < previous.length && !reason; index += pageSize) {
            await consume(previous.slice(index, index + pageSize));
          }
        }
        return result({
          partial: true,
          ...(offset && (reusedTail || records.length >= previous.length) ? { records } : {}),
        });
      }
      const rows = history.records.slice(skip);
      await consume(rows);
      offset += rows.length;
      if (reason) break;

      if (!reusedTail && page < history.pages) {
        // A matching suffix joins the freshly checked prefix to its cached continuation.
        const seam = rows.findIndex((row, index) => {
          const priorIndex = previousById.get(row.id);
          return priorIndex !== undefined && rows.slice(index).every(({ id }, next) =>
            id && id === previous[priorIndex + next]?.id);
        });
        if (seam >= 0) {
          const tail = previousById.get(rows[seam].id) + rows.length - seam;
          const remaining = Math.min(previous.length - tail, Math.max(0, history.total - offset));
          for (let index = 0; index < remaining && !reason; index += pageSize) {
            await consume(previous.slice(tail + index, tail + Math.min(remaining, index + pageSize)));
          }
          offset += remaining;
          reusedTail = true;
        }
      }
      if (!reason && (page >= history.pages || offset >= history.total)) reason = "end";
    }

    return result({ reason: reason ?? "cap", records });

    function result(coverage) {
      return {
        status: "ok", ...coverage,
        pricingIncomplete: eligible.some((row) => row.pricingIncomplete),
        groups: itemPreview(eligible, assetId, now),
      };
    }
  }

  return { sampleItem };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RoxolOverpaySampling;
