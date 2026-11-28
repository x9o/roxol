const RoxolProofOverpay = (() => {
  const channel = "https://discord.com/channels/415246288779608064/535250426061258753";
  const number = String.raw`(\d+(?:,\d{3})*(?:\.\d+)?\s*[km]?)`;
  const totals = new RegExp(`^${number}\\s*(?:vs?\\.?|/|→)\\s*${number}\\s*(?:\\([^()]*\\))?$`, "i");
  const robux = new RegExp(`^${number}\\s*(?:robux|rbx|r\\$)$`, "i");
  const trailingRobux = new RegExp(`^(.+?)\\s+(${number}\\s*(?:robux|rbx|r\\$))$`, "i");
  const isAttachment = (url) => typeof url === "string" &&
    /^https:\/\/nevos-extension\.com\/api\/proofs\/images\/\d{5,32}$/.test(url);

  function amount(text) {
    const value = text.replace(/[\s,]/g, "").toLowerCase();
    const multiplier = value.endsWith("m") ? 1e6 : value.endsWith("k") ? 1e3 : 1;
    const result = Number.parseFloat(value) * multiplier;
    const rounded = Math.round(result);
    return Number.isSafeInteger(rounded) && Math.abs(result - rounded) < 1e-6 ? rounded : null;
  }

  function key(text) {
    return String(text ?? "").normalize("NFKC").replace(/[‘’]/g, "'").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function itemLookup(item, data, feed) {
    const focal = { price: null, focal: true };
    const aliases = new Map();
    for (const [id, entry] of feed ?? []) {
      const resolved = id === item.key ? focal : { price: entry.value || entry.rap };
      if (resolved === focal) focal.price = entry.value || entry.rap;
      for (const name of new Set([key(entry.name), key(entry.acronym)])) {
        if (name) aliases.set(name, aliases.has(name) ? null : resolved);
      }
    }
    for (const name of [item.name, data.item_name, data.acronym].map(key)) {
      if (name && (!aliases.has(name) || aliases.get(name) === focal)) aliases.set(name, focal);
    }
    return aliases;
  }

  function readBasket(side, aliases) {
    function readItem(text) {
      const normalized = key(text);
      if (aliases.has(normalized)) return aliases.get(normalized);
      const parenthetical = /^(.*?)\s*\(([^()]+)\)$/.exec(normalized);
      if (!parenthetical) return null;
      const full = aliases.get(key(parenthetical[1]));
      return full && full === aliases.get(key(parenthetical[2])) ? full : null;
    }

    // Try the whole name before splitting so punctuation in a Limited's name stays intact.
    const entries = readItem(side) ? [side] : side.split(/\s*\+\s*|,\s*(?:and\s+)?(?=\D)|\s+(?:&|and)\s+/i)
      .flatMap((entry) => trailingRobux.exec(entry.trim())?.slice(1, 3) ?? [entry]);
    const items = [];
    let cash = null;
    for (const entry of entries) {
      const payment = robux.exec(entry.trim());
      if (payment) {
        if (cash !== null) return null;
        cash = amount(payment[1]);
        if (cash === null) return null;
        continue;
      }
      const copies = /^(?:([1-4])\s*x\s*|x\s*([1-4])\s+)(.+)$|^(.+?)\s+x\s*([1-4])$/i.exec(entry.trim());
      const direct = readItem(entry);
      const item = direct ?? (copies && readItem(copies[3] ?? copies[4]));
      if (!item) return null;
      const quantity = copies && !direct ? Number(copies[1] ?? copies[2] ?? copies[5]) : 1;
      for (let i = 0; i < quantity; i++) items.push(item);
    }
    return items.length && items.length <= 4 ? { items, cash: cash ?? 0 } : null;
  }

  function readTrade(content, aliases) {
    if (typeof content !== "string") return null;
    const [description, ...lines] = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sides = description?.replace(/^item(?:s|\(s\))?\s*:\s*/i, "").split(/\s*\/\s*|\s+vs?\.?\s+/i);
    if (sides?.length !== 2 || sides.some((side) => !side)) return null;
    const baskets = sides.map((side) => readBasket(side, aliases));
    if (baskets.some((basket) => !basket)) return null;
    const focalCounts = baskets.map(({ items }) => items.filter((item) => item.focal).length);
    if (focalCounts[0] + focalCounts[1] !== 1) return null;
    const side = focalCounts.indexOf(1);
    const given = baskets[side];
    const received = baskets[1 - side];
    if (received.items.length === 1 && !received.cash) return null;

    const itemOnly = /^items?(?:[- ]only)?\s+(?:values?|totals?)\s*:\s*/i;
    const reportedTotals = lines.flatMap((line) => {
      const labeled = itemOnly.test(line);
      if ((given.cash || received.cash) && !labeled) return [];
      const pair = totals.exec(line.replace(itemOnly, "").replace(/^values?\s*:\s*/i, ""));
      if (!pair || !labeled && pair.slice(1).some((value) => /^\d{1,3}\s*$/.test(value))) return [];
      const values = pair.slice(1).map(amount);
      return values.every((value) => value > 0) ? [values] : [];
    });
    if (!reportedTotals.length) return null;
    const [givenValue, receivedValue] = side === 0 ? reportedTotals[0] : reportedTotals[0].toReversed();
    if (reportedTotals.some((pair) => pair[side] !== givenValue || pair[1 - side] !== receivedValue)) return null;

    const focal = given.items.find((item) => item.focal);
    const adds = given.items.filter((item) => !item.focal);
    if (adds.length && (!focal.price || adds.some(({ price }) => !price) ||
        adds.reduce((sum, { price }) => sum + price, 0) >= focal.price / 2)) return null;

    // With the focal alone, a cheaper historical incoming basket also proves every item is smaller.
    const historicallySmaller = !adds.length && (receivedValue < givenValue ||
      receivedValue === givenValue && received.items.length > 1);
    if (received.items.length === 1 && receivedValue >= givenValue) return null;
    if (!historicallySmaller && (!focal.price || received.items.some(({ price }) => !price || price >= focal.price))) return null;

    const incomingRobux = Math.round(received.cash * 0.7);
    const net = receivedValue + incomingRobux - givenValue - given.cash;
    return { net, given: sides[side], opposite: sides[1 - side], givenValue, receivedValue,
      outgoingRobux: given.cash, incomingRobux, incomingRobuxOffered: received.cash };
  }

  function summarize(data, item, feed) {
    const aliases = itemLookup(item, data, feed);
    const seenPosts = new Set();
    const seenImages = new Set();
    const trades = [];
    for (const proof of data.results) {
      if (typeof proof?.id !== "string" || !/^\d{17,20}$/.test(proof.id) || seenPosts.has(proof.id)) continue;
      seenPosts.add(proof.id);
      const trade = readTrade(proof.content, aliases);
      if (!trade) continue;
      const attachments = Array.isArray(proof.attachments) ? [...new Set(proof.attachments.filter(isAttachment))] : [];
      if (attachments.some((url) => seenImages.has(url))) continue;
      for (const url of attachments) seenImages.add(url);
      const time = Number(proof.timestamp) || Number((BigInt(proof.id) >> 22n) + 1420070400000n);
      trades.push({ ...trade, attachments, discordUrl: `${channel}/${proof.id}`,
        date: time > 0 && time <= 8.64e15 ? new Date(time).toISOString() : null });
    }
    trades.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    const median = (values) => {
      const sorted = values.sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length ? (sorted[middle] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2 : null;
    };
    return {
      status: "ok", channel, trades, median: median(trades.map(({ net }) => Math.abs(net))),
      postCount: seenPosts.size, unpricedPosts: seenPosts.size - trades.length,
      partial: Number(data.count) > seenPosts.size,
    };
  }

  return { summarize, isAttachment };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RoxolProofOverpay;
