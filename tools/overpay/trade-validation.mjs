import { validBasket } from "./stats.mjs";

const day = 86_400_000;
const minute = 60_000;
const maxObservationLag = 2 * day;
const idPattern = /^[1-9]\d{0,19}$/;

export function assetCopies(items) {
  if (!Array.isArray(items) || !items.length || items.some(({ assetId, quantity }) =>
    !idPattern.test(assetId ?? "") || !Number.isInteger(quantity) || quantity < 1 || quantity > 4)) return null;
  const copies = items.flatMap((item) => item.quantity === 1 ? [item] :
    Array.from({ length: item.quantity }, () => ({ assetId: item.assetId })));
  return copies.length <= 4 ? copies : null;
}

function fingerprint(sides) {
  return sides.map((side) => side.map(({ assetId }) => assetId).sort().join(",")).sort().join("|");
}

function completionWindow(date, offset) {
  if (typeof date !== "string") return null;
  const time = Date.parse(date);
  if (!Number.isFinite(time)) return null;
  if (date.includes("T")) return [time, time];
  if (Number.isInteger(offset)) return [time - offset * minute, time + day - offset * minute - 1];
  // The proof shows a civil date but does not identify its time zone.
  return [time - 14 * 60 * minute, time + day + 12 * 60 * minute - 1];
}

function copyScore(expected, observed) {
  if (!expected.length) return 0;
  const [copy, ...rest] = expected;
  let best = -Infinity;
  for (const [index, candidate] of observed.entries()) {
    if (copy.assetId !== candidate.assetId) continue;
    const comparable = ["instanceId", "userAssetId", "serial"].filter((field) => copy[field] && candidate[field]);
    if (comparable.some((field) => String(copy[field]).toLowerCase() !== String(candidate[field]).toLowerCase())) continue;
    const remaining = observed.filter((_, i) => i !== index);
    best = Math.max(best, Number(comparable.length > 0) + copyScore(rest, remaining));
  }
  return best;
}

function matchingCandidates(proof, sides, candidates) {
  const [start, end] = completionWindow(proof.date, proof.offset);
  const compatible = [];
  let copyConflicts = 0;
  for (const { trade, copies } of candidates) {
    const times = [trade.firstObservedAt, trade.lastObservedAt].map(Date.parse).filter(Number.isFinite);
    if (!times.length || Math.max(...times) < start - 5 * minute ||
        Math.min(...times) > end + maxObservationLag) continue;
    const orientations = [0, 1].map((a) => ({
      reversed: a === 1,
      matchingCopies: copyScore(sides[0], copies[a]) + copyScore(sides[1], copies[1 - a]),
    })).filter(({ matchingCopies }) => Number.isFinite(matchingCopies))
      .sort((left, right) => right.matchingCopies - left.matchingCopies);
    if (!orientations.length) {
      copyConflicts++;
      continue;
    }
    const best = orientations[0];
    compatible.push({
      tradeId: trade.tradeId, inferred: trade.inferred, ...best,
      orientationKnown: best.matchingCopies !== orientations[1]?.matchingCopies,
      firstObservedAt: trade.firstObservedAt, lastObservedAt: trade.lastObservedAt,
      observationDelayHours: [(Math.min(...times) - end) / 3_600_000,
        (Math.max(...times) - start) / 3_600_000],
    });
  }
  const highest = Math.max(...compatible.map(({ matchingCopies }) => matchingCopies));
  return { candidates: compatible.filter(({ matchingCopies }) => matchingCopies === highest), copyConflicts };
}

export function validateTrades(trades, pilot) {
  if (!Array.isArray(pilot?.pricedTrades)) throw new Error("Expected the reviewed completed trades in pilot.json.");
  const byBasket = new Map();
  for (const trade of trades) {
    const copies = [trade.sideA, trade.sideB].map(assetCopies);
    if (!copies.every(Boolean)) continue;
    const key = fingerprint(copies);
    if (!byBasket.has(key)) byBasket.set(key, []);
    byBasket.get(key).push({ trade, copies });
  }

  const comparisons = pilot.pricedTrades.filter((proof) => !proof.conflict && proof.status !== "conflict").map((proof) => {
    const base = { proofId: proof.id, robloxTradeId: proof.tradeId ?? null, date: proof.date };
    if (!Array.isArray(proof.baskets) || proof.baskets.length !== 2 ||
        !proof.baskets.every(validBasket) || proof.baskets.flat().some(({ kind }) => kind !== "asset") ||
        !completionWindow(proof.date, proof.offset)) return { ...base, status: "unsupported-proof" };
    const sides = proof.baskets.map((basket) => assetCopies(basket.map((item) => ({
      ...item, assetId: item.id, userAssetId: item.userAssetId ?? item.copyId,
    }))));
    const comparison = matchingCandidates(proof, sides, byBasket.get(fingerprint(sides)) ?? []);
    return { ...base, ...comparison, robux: Array.isArray(proof.robux) && proof.robux.length === 2
      ? proof.robux.map((amount) => Number.isSafeInteger(amount) && amount >= 0 ? amount : null)
      : [null, null], robuxBasis: proof.robuxBasis ?? null };
  });

  const candidateUse = new Map();
  for (const { candidates } of comparisons) {
    for (const { tradeId } of candidates ?? []) candidateUse.set(tradeId, (candidateUse.get(tradeId) ?? 0) + 1);
  }
  const matched = new Map();
  const proofs = comparisons.map(({ candidates, robux, robuxBasis, ...proof }) => {
    if (!candidates) return proof;
    if (!candidates.length) return { ...proof, status: proof.copyConflicts ? "copy-conflict" : "not-found" };
    const [match] = candidates;
    if (candidates.length > 1 || candidateUse.get(match.tradeId) > 1 || !match.orientationKnown) {
      return { ...proof, status: "ambiguous", candidateTradeIds: candidates.map(({ tradeId }) => tradeId) };
    }
    const orderedRobux = match.reversed ? [...robux].reverse() : robux;
    const result = { ...proof, ...match, status: match.matchingCopies ? "copy-corroborated" : "basket-match",
      robux: { sideA: orderedRobux[0], sideB: orderedRobux[1], basis: robuxBasis } };
    matched.set(match.tradeId, result);
    return result;
  });
  const byProviderFlag = {};
  for (const flag of [true, false, null]) {
    const records = trades.filter(({ inferred }) => inferred === flag);
    byProviderFlag[String(flag)] = {
      records: records.length,
      basketMatches: records.filter(({ tradeId }) => matched.get(tradeId)?.status === "basket-match").length,
      copyCorroborated: records.filter(({ tradeId }) => matched.get(tradeId)?.status === "copy-corroborated").length,
    };
  }
  return { proofs, matched, summary: {
    byProviderFlag, proofsReviewed: pilot.pricedTrades.length, conflictingProofs: pilot.pricedTrades.length - proofs.length,
    proofOutcomes: Object.fromEntries(Object.entries(Object.groupBy(proofs, ({ status }) => status))
      .map(([status, rows]) => [status, rows.length])),
    matchesWithRobux: [...matched.values()].filter(({ robux }) => robux.sideA > 0 || robux.sideB > 0).length,
  } };
}
