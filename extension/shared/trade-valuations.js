const RoxolTradeValuations = (() => {
  function amount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function timestamp(seconds) {
    const time = seconds * 1000;
    return typeof seconds === "number" && Number.isSafeInteger(time) && time > 0 && time <= 8.64e15
      ? time : null;
  }

  function iso(time) {
    return time === null ? null : new Date(time).toISOString();
  }

  function parseHistory(html, target, currentValue, source, trackedFrom) {
    const match = /\bvar value_changes\s*=\s*(\[[^;]*\]);/.exec(html);
    if (!match) return null;
    let rows;
    try {
      rows = JSON.parse(match[1]);
    } catch {
      return null;
    }
    if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) return null;
    // Item profiles omit the item ID and type from each row. The standalone change log includes both.
    const profile = trackedFrom !== undefined;
    const changes = (profile ? rows.filter((row) => row[1] === 1) : rows.filter(
      ([, id, type, change]) => String(id) === target.id && type === (target.kind === "bundle" ? 2 : 1) && change === 1,
    ).map(([seconds, , , change, before, after]) => [seconds, change, before, after]))
      .map(([seconds, , before, after]) => ({ time: seconds * 1000, before, after }))
      .sort((a, b) => a.time - b.time);
    if (profile) {
      if (!Number.isSafeInteger(trackedFrom) || trackedFrom <= 0) return null;
      if (changes.some(({ time, before, after }) => time < trackedFrom ||
          ![before, after].every((value) => value === null || (Number.isSafeInteger(value) && value > 0)))) return null;
      if (!changes.length && currentValue === null) return { source, changes, unvaluedFrom: trackedFrom };
    }
    if (!changes.length || changes.some((entry, i) => !Number.isSafeInteger(entry.time) ||
        entry.time <= 0 || entry.time > 8.64e15 ||
        (i > 0 && (entry.time <= changes[i - 1].time || entry.before !== changes[i - 1].after))) ||
        (currentValue !== undefined && changes.at(-1).after !== currentValue)) return null;
    return {
      source, changes,
      ...(profile && changes[0].before === null ? { unvaluedFrom: trackedFrom } : {}),
    };
  }

  function assignmentAt(history, from, through = from) {
    if (!history || !Number.isFinite(from) || !Number.isFinite(through) || through < from ||
        history.changes.some(({ time }) => time > from && time <= through)) return null;
    const change = history.changes.findLast(({ time }) => time <= from);
    if (change) return { value: change.after, effectiveAt: new Date(change.time).toISOString(), source: history.source };
    if (history.unvaluedFrom <= from) {
      return { value: null, effectiveAt: new Date(history.unvaluedFrom).toISOString(), source: history.source };
    }
    return null;
  }

  function sameUtcDay(left, right) {
    const day = 86_400_000;
    return Math.floor(left / day) === Math.floor(right / day);
  }

  function embeddedJson(html, name) {
    const match = new RegExp(`\\bvar ${name}\\s*=\\s*(\\{[^\\r\\n]*\\})\\s*;`).exec(html);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }

  function parseItemProfile(html, id, source, checkedAt) {
    const details = embeddedJson(html, "item_details_data");
    if (String(details?.item_id) !== id ||
        (details.value !== null && !(amount(details.value) > 0))) return null;
    const trackedFrom = timestamp(details.first_timestamp);
    const history = parseHistory(html, { kind: "asset", id }, details.value, source, trackedFrom);
    const chart = embeddedJson(html, "history_data");
    const rap = [];
    let rapHistoryUnavailable = "missing-or-invalid-rap-history";
    if (Array.isArray(chart?.timestamp) && Array.isArray(chart.rap) &&
        chart.timestamp.length === chart.rap.length && chart.num_points === chart.rap.length) {
      rapHistoryUnavailable = null;
      for (const [index, seconds] of chart.timestamp.entries()) {
        const time = timestamp(seconds);
        if (!time || time <= (rap.at(-1)?.[0] ?? 0) || time > checkedAt) {
          rap.length = 0;
          rapHistoryUnavailable = "missing-or-invalid-rap-history";
          break;
        }
        rap.push([time, amount(chart.rap[index])]);
      }
    }
    return { checkedAt, source, history, rap, rapHistoryUnavailable, currentValue: details.value, currentRap: amount(details.rap) };
  }

  function rapAt(profile, time) {
    if (!profile || time === null || time > profile.checkedAt) return null;
    const point = profile.rap.findLast(([sampledAt]) => sampledAt <= time);
    if (!point || point[1] == null || !sameUtcDay(point[0], time)) return null;
    return { method: "rap-snapshot", value: point[1], effectiveAt: iso(point[0]), source: profile.source };
  }

  function valueThenComparison(reported, assignment) {
    if (!assignment) return "unverified";
    if (!(reported > 0)) return assignment.value === null ? "no-assigned-value" : "missing-assigned-value";
    if (assignment.value === null) return "reported-for-unvalued-item";
    return assignment.value === reported ? "match" : "different-value";
  }

  function priceItem(item, profile, from, through) {
    const assignment = profile && through <= profile.checkedAt ? assignmentAt(profile.history, from, through) : null;
    const tradeDateKnown = sameUtcDay(from, through);
    const historical = assignment?.value > 0 ? { method: "assigned-value", ...assignment }
      : assignment && tradeDateKnown ? rapAt(profile, through) : null;
    const currentAmount = profile?.currentValue ?? profile?.currentRap;
    const current = currentAmount == null ? null : {
      method: profile.currentValue === null ? "rap-snapshot" : "assigned-value",
      value: currentAmount, effectiveAt: iso(profile.checkedAt), source: profile.source,
    };
    const itemTime = item.observedAt ? Date.parse(item.observedAt) : null;
    const itemAssignment = profile && itemTime !== null && itemTime <= profile.checkedAt
      ? assignmentAt(profile.history, itemTime) : null;
    const comparison = itemAssignment ?? (itemTime === null ? assignment : null);
    let historicalUnavailable = null;
    if (!profile) historicalUnavailable = "profile-unavailable";
    else if (!Number.isFinite(from) || !Number.isFinite(through) || through < from) historicalUnavailable = "invalid-observation-time";
    else if (through > profile.checkedAt) historicalUnavailable = "observation-after-profile";
    else if (!profile.history) historicalUnavailable = "incomplete-assigned-value-history";
    else if (!assignment) historicalUnavailable = profile.history.changes.some(({ time }) => time > from && time <= through)
      ? "assigned-value-changed-during-observation" : "observation-before-assigned-value-history";
    else if (!historical) historicalUnavailable = tradeDateKnown
      ? profile.rapHistoryUnavailable ?? "no-prior-rap-snapshot-on-trade-date" : "trade-observations-span-utc-dates";
    else if (historical.value === 0) historicalUnavailable = "zero-rap-snapshot";
    return {
      ...item, assignment, historical, current, profileObservedAt: profile ? iso(profile.checkedAt) : null,
      historicalUnavailable,
      valueThenComparison: valueThenComparison(item.valueThen, comparison),
      valueThenReference: comparison,
      rapAtItemObservation: rapAt(profile, itemTime),
    };
  }

  function basketTotal(items, field) {
    let total = 0;
    for (const item of items) {
      if (item.quantity == null || item[field]?.value == null) return null;
      total += item.quantity * item[field].value;
      if (!Number.isSafeInteger(total)) return null;
    }
    return total;
  }

  function itemOnlyOverpay(sideA, sideB, field) {
    const sideATotal = basketTotal(sideA, field);
    const sideBTotal = basketTotal(sideB, field);
    const signedOverpay = sideATotal === null || sideBTotal === null ? null : sideBTotal - sideATotal;
    return {
      sideATotal, sideBTotal, signedOverpay,
      overpayPercent: signedOverpay === null || !sideATotal ? null : signedOverpay / sideATotal * 100,
    };
  }

  function observationWindow(trade) {
    const first = Date.parse(trade.firstObservedAt);
    const last = Date.parse(trade.lastObservedAt);
    const from = Number.isFinite(first) ? first : last;
    const through = Number.isFinite(last) ? last : first;
    return { from, through, valid: Number.isFinite(through) && through >= from };
  }

  function resolveTrades(trades, profiles) {
    return trades.map((trade) => {
      const { from, through, valid } = observationWindow(trade);
      const price = (item) => priceItem(item, profiles.get(item.assetId), from, through);
      const sideA = trade.sideA.map(price);
      const sideB = trade.sideB.map(price);
      return {
        ...trade, sideA, sideB,
        valuationAt: valid ? iso(through) : null,
        robux: { sideA: null, sideB: null },
        historicalItemOnlyOverpay: itemOnlyOverpay(sideA, sideB, "historical"),
        currentItemOnlyOverpay: itemOnlyOverpay(sideA, sideB, "current"),
      };
    });
  }

  return { amount, timestamp, iso, parseHistory, assignmentAt, parseItemProfile, observationWindow, resolveTrades };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RoxolTradeValuations;
