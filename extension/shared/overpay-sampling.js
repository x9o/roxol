const RoxolOverpaySampling = (() => {
  const pageSize = 50;
  const rawCap = 500;

  async function sampleItem({ assetId, previous, readPage, readTradeProfile, readStoredProfile,
    onProgress = () => {}, isActive = () => true, clock = Date.now, now = clock() }) {
    const { itemPreview, previewSample, isolatedSide, unusualComposition, tradeGroup, recentDays } = RoxolItemOverpay;
    const cutoff = now - recentDays * 86_400_000;
    const records = [];
    const eligible = [];
    const seen = new Set();
    const exclusions = {};
    const needed = new Map();
    const groupSizes = { swap: 0, downgrade: 0 };
    const lookups = new Map();
    const profiles = new Map();
    let pricingRetryAt = null;
    let retryReason = null;
    let reason;
    let historyFailure;
    const previousById = new Map();
    for (const [index, { id }] of previous.entries()) {
      if (id && !previousById.has(id)) previousById.set(id, index);
    }

    function consume(rows) {
      for (const incoming of rows) {
        if (records.length === rawCap) break;
        const { id, trade, firstObservedAt } = incoming;
        const prior = previous[previousById.get(id)];
        const row = prior === incoming ||
          (prior?.sample && JSON.stringify(prior.trade) === JSON.stringify(trade)) ? { ...prior } : { ...incoming };
        records.push(row);
        delete row.exclusion;
        // RoUtility pages in decreasing order of its first observation timestamp.
        if (Date.parse(firstObservedAt) <= cutoff) reason = "date";
        if (reason === "date") row.exclusion = "outside-window";
        else if (!trade) row.exclusion = row.invalidReason ?? "invalid-source-record";
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
            eligible.push(row);
            const group = tradeGroup(sides[1 - isolated]);
            groupSizes[group]++;
            if (row.sample?.overpay == null) {
              const candidate = { row, from, group };
              const ids = new Set(sides.flat().map(({ assetId: id }) => id));
              for (const id of ids) {
                const need = needed.get(id) ?? { through: 0, candidates: [] };
                need.through = Math.max(through, need.through);
                need.candidates.push(candidate);
                needed.set(id, need);
              }
            }
          }
        }
        if (row.exclusion) exclusions[row.exclusion] = (exclusions[row.exclusion] ?? 0) + 1;
      }
      if (!reason && records.length === rawCap) reason = "cap";
    }

    let offset = 0;
    let reusedTail = false;
    for (let requests = 0; requests < rawCap / pageSize && !reason; requests++) {
      const page = Math.floor(offset / pageSize) + 1;
      const skip = offset % pageSize;
      const history = await readPage(page, pageSize).catch((error) => ({ message: error.message }));
      if (history?.status !== "ok") {
        historyFailure = { page, httpStatus: history?.httpStatus ?? null, message: history?.message ?? null };
        if (!offset && !previous.length) return { status: "unavailable", historyFailure };
        if (!offset) consume(previous);
        break;
      }
      const rows = history.records.slice(skip);
      consume(rows);
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
          consume(previous.slice(tail, tail + remaining));
          offset += remaining;
          reusedTail = true;
        }
      }
      if (!reason && (page >= history.pages || offset >= history.total)) reason = "end";
    }

    function valueCandidates(candidates) {
      const pending = candidates.filter(({ row }) => row.sample?.overpay == null);
      const valued = RoxolTradeValuations.resolveTrades(pending.map(({ row }) => row.trade), profiles);
      pending.forEach(({ row, from }, index) => {
        row.sample = previewSample(valued[index], assetId, from);
        row.sample.pricingFailures = row.sample.pricingFailures.map((failure) => {
          if (!failure.assetId) return failure;
          const lookup = lookups.get(failure.assetId);
          if (!lookup) return { ...failure, reason: "deferred-profile-lookup", pending: true };
          if (lookup.refresh && failure.reason === "observation-after-profile") {
            return { ...failure, pending: true };
          }
          if (lookup.failure && (!lookup.profile?.history || failure.reason === "observation-after-profile")) {
            return { ...failure, ...lookup.failure, ...(lookup.retryAt ? { pending: true } : {}) };
          }
          return { ...failure, httpStatus: lookup.profile ? 200 : null };
        });
      });
    }

    function accept(id, lookup) {
      lookups.set(id, lookup);
      if (lookup.profile) profiles.set(id, lookup.profile);
      if (lookup.retryAt && (pricingRetryAt === null || lookup.retryAt < pricingRetryAt)) {
        pricingRetryAt = lookup.retryAt;
        retryReason = lookup.failure?.reason;
      }
    }

    function result(pricingActive = false) {
      const groups = itemPreview(eligible, assetId, now);
      for (const { summary, history } of Object.values(groups)) {
        const { valuationCoverage } = summary;
        valuationCoverage.pendingTrades = history.filter(({ pricingFailures }) =>
          pricingFailures.length && pricingFailures.every(({ pending }) => pending)).length;
        valuationCoverage.unavailableTrades = valuationCoverage.eligibleTrades -
          valuationCoverage.pricedTrades - valuationCoverage.pendingTrades;
      }
      const canPriceMore = Object.values(groups).some(({ summary }) => summary.valuationCoverage.pendingTrades);
      const audit = records.map(({ id, firstObservedAt, trade, rejectedTrade, exclusion, sample }) => ({
        id, firstObservedAt, trade: trade ?? rejectedTrade ?? null, exclusion, ...(exclusion ? {} : { sample }),
      }));
      return {
        status: "ok", asOf: new Date(now).toISOString(), fromExclusive: new Date(cutoff).toISOString(),
        ...(historyFailure ? { partial: true, historyFailure } : { reason: reason ?? "cap" }),
        pricingActive, pricingRetryAt: canPriceMore ? pricingRetryAt : null, retryReason, audit, exclusions, groups,
        pricingIncomplete: eligible.some(({ sample }) => sample.overpay === null),
      };
    }

    if (needed.size) {
      if (readStoredProfile) {
        await Promise.all([...needed].map(async ([id, { through }]) => {
          const lookup = await readStoredProfile(id, through);
          if (lookup) accept(id, lookup);
        }));
      }
      const candidates = needed.get(assetId).candidates;
      valueCandidates(candidates);
      onProgress(result(true));

      while (true) {
        // Give equal weight to each group's coverage and favor baskets closest to being fully priced.
        const scores = new Map();
        for (const { row, group } of candidates) {
          const failures = row.sample.pricingFailures;
          if (!failures.length || failures.some(({ pending }) => !pending)) continue;
          const missing = new Set(failures.map(({ assetId: id }) => id));
          const weight = 1 / (groupSizes[group] * missing.size ** 2);
          for (const id of missing) {
            if (!lookups.has(id) || lookups.get(id).refresh) scores.set(id, (scores.get(id) ?? 0) + weight);
          }
        }
        const id = scores.has(assetId) ? assetId : [...scores].reduce((best, entry) =>
          entry[1] > best[1] ? entry : best, [null, 0])[0];
        if (!id || (pricingRetryAt !== null && pricingRetryAt <= clock())) break;
        if (!isActive()) {
          pricingRetryAt = clock();
          break;
        }
        const { through, candidates: affected } = needed.get(id);
        const lookup = await readTradeProfile(id, through);
        accept(id, lookup);
        valueCandidates(affected);
        onProgress(result(true));
        // With a shared cooldown or exhausted budget, no remaining profile can start this pass.
        if (lookup.retryAt && (lookup.failure?.reason.startsWith("deferred-") || lookup.failure?.httpStatus === 429)) {
          pricingRetryAt = Math.max(pricingRetryAt ?? 0, lookup.retryAt);
          retryReason = lookup.failure.httpStatus === 429 ? "deferred-provider-cooldown" : lookup.failure.reason;
          break;
        }
        if (id === assetId && !lookup.profile?.history) break;
      }
    }

    return {
      ...result(),
      ...(!historyFailure || (offset && (reusedTail || records.length >= previous.length)) ? { records } : {}),
    };
  }

  return { sampleItem };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RoxolOverpaySampling;
