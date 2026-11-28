const RoxolProofOverpay = (() => {
  const channel = "https://discord.com/channels/415246288779608064/535250426061258753";
  const number = String.raw`(\d+(?:,\d{3})*(?:\.\d+)?\s*[km]?)`;
  const totals = new RegExp(`^${number}\\s*(?:vs?\\.?|/|→)\\s*${number}(?=\\s|\\(|$)`, "i");
  const explicit = new RegExp(`(?:^|\\()\\s*${number}\\s*(?:op|overpay)\\s+(?:for|on)\\s+([^)]*)`, "i");
  const isAttachment = (url) => typeof url === "string" &&
    /^https:\/\/nevos-extension\.com\/api\/proofs\/images\/\d{5,32}$/.test(url);

  function amount(text) {
    const value = text.replace(/[\s,]/g, "").toLowerCase();
    const multiplier = value.endsWith("m") ? 1e6 : value.endsWith("k") ? 1e3 : 1;
    const result = Number.parseFloat(value) * multiplier;
    return Number.isSafeInteger(result) && result >= 0 ? result : null;
  }

  function key(text) {
    return String(text ?? "").normalize("NFKC").replace(/[‘’]/g, "'").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function readTrade(content, names) {
    if (typeof content !== "string") return null;
    const [description, ...lines] = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sides = description?.replace(/^item(?:s|\(s\))?\s*:\s*/i, "").split(/\s*\/\s*|\s+vs?\.?\s+/i);
    if (sides?.length !== 2 || sides.some((side) => !side)) return null;
    const matches = (text) => {
      const normalized = key(text).replace(/^1\s*x\s*|\s+x\s*1$/g, "");
      if (names.has(normalized)) return true;
      const parenthetical = /^(.*?)\s*\(([^()]+)\)$/.exec(normalized);
      return Boolean(parenthetical && names.has(key(parenthetical[1])) && names.has(key(parenthetical[2])));
    };
    const side = sides.findIndex(matches);
    if (side < 0 || sides[1 - side].split(/\s*(?:[,+&]|\band\b)\s*/i).some((entry) =>
      matches(entry.replace(/^\s*\d+\s*x\s*|\s*x\s*\d+\s*$/gi, "")))) return null;

    for (const raw of lines) {
      const line = raw.replace(/^values?\s*:\s*/i, "");
      const pair = totals.exec(line);
      if (pair) {
        const amounts = pair.slice(1);
        if (!amounts.some((value) => /^\d{1,3}\s*$/.test(value))) {
          const values = amounts.map(amount);
          if (values.every((value) => value > 0)) {
            return { net: values[1 - side] - values[side], focalValue: values[side], opposite: sides[1 - side] };
          }
        }
      }
      const reported = explicit.exec(line);
      if (reported && matches(reported[2])) {
        const net = amount(reported[1]);
        if (net !== null) return { net, focalValue: null, opposite: sides[1 - side] };
      }
    }
    return null;
  }

  function summarize(data, item) {
    const names = new Set([item.name, item.acronym, data.item_name, data.acronym].map(key).filter(Boolean));
    const seenPosts = new Set();
    const seenImages = new Set();
    const trades = [];
    for (const proof of data.results) {
      if (typeof proof?.id !== "string" || !/^\d{17,20}$/.test(proof.id) || seenPosts.has(proof.id)) continue;
      seenPosts.add(proof.id);
      const trade = readTrade(proof.content, names);
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
      status: "ok", channel, trades, median: median(trades.map(({ net }) => net)),
      medianPercent: median(trades.flatMap(({ net, focalValue }) => focalValue ? [100 * net / focalValue] : [])),
      postCount: seenPosts.size, unpricedPosts: seenPosts.size - trades.length,
      partial: Number(data.count) > seenPosts.size,
    };
  }

  return { summarize, isAttachment };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RoxolProofOverpay;
