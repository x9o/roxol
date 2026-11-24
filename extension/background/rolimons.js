const RoxolRolimons = (() => {
  const { idOf, keyOf, amount } = RoxolTargets;
  const { ROW_RAP, ROW_VALUE, get_item_demand, is_item_rare } = RolimonsItemDetails;
  const demandLabels = ["Terrible", "Low", "Normal", "High", "Amazing"];
  const trendLabels = ["Lowering", "Unstable", "Stable", "Raising", "Fluctuating"];
  const valueTiers = [4000, 4500];
  for (let value = 5000; value <= 16000; value += 1000) valueTiers.push(value);
  for (let value = 18000; value <= 32000; value += 2000) valueTiers.push(value);
  valueTiers.push(35000, 38000, 40000, 42000, 45000, 48000, 50000);
  for (let value = 55000; value <= 100000; value += 5000) valueTiers.push(value);

  function rapSignal(rap, value, demand, projected) {
    const tier = valueTiers.indexOf(value);
    if (!rap || tier < 0 || tier === valueTiers.length - 1 || projected !== false || demand === "Terrible") return null;

    // RAP at one tier supports the next value tier. Apply Nevos's 2% drop buffer.
    const supported = Math.min(valueTiers.findLastIndex((step) => rap >= step) + 1, valueTiers.length - 1);
    if (tier === supported || Math.abs(tier - supported) > 4) return null;
    if (supported > tier) return { direction: "raise", target: valueTiers[supported], threshold: valueTiers[supported - 1] };

    const threshold = valueTiers[tier - 1] * 0.98;
    if (rap >= threshold) return null;
    return { direction: "drop", target: valueTiers[supported], threshold };
  }

  function itemIndex(payload, checkedAt = Date.now()) {
    if (payload?.success !== true) return null;
    const index = new Map();
    const splitFeed = payload.assets || payload.bundles;
    const maps = splitFeed ? [["asset", payload.assets], ["bundle", payload.bundles]] : [["asset", payload.items]];
    for (const [type, rows] of maps) {
      for (const [id, row] of Object.entries(rows || {})) {
        if (!idOf(id) || !Array.isArray(row) || typeof row[0] !== "string") continue;
        const kind = !splitFeed && payload.bundleIds?.[id] ? "bundle" : type;
        const rap = amount(row[ROW_RAP]);
        const value = amount(row[ROW_VALUE]);
        const demand = row[5] == null ? null : demandLabels[get_item_demand(row)] ?? null;
        const projected = [0, 1, -1].includes(row[7]) ? row[7] === 1 : null;
        index.set(keyOf({ kind, id }), {
          name: row[0], acronym: row[1] || null, rap, value, fallbackValue: amount(row[4]),
          demand, trend: trendLabels[row[6]] ?? null, projected, rare: is_item_rare(row),
          signal: rapSignal(rap, value, demand, projected), checkedAt,
        });
      }
    }
    return index.size ? index : null;
  }

  function timestamp(seconds) {
    const ms = Number(seconds) * 1000;
    return Number.isSafeInteger(ms) && ms > 0 && ms <= 8.64e15 ? ms : null;
  }

  function priceOf(value) {
    if (typeof value === "string" && /^-?\d[\d,]*$/.test(value.trim())) value = Number(value.replaceAll(",", ""));
    return Number.isSafeInteger(value) ? value : null;
  }

  function chartData(html) {
    const json = /\b(?:var|let|const)\s+item_sales\s*=\s*(\{[^<]*?\})\s*;/.exec(html)?.[1];
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function salesList(html) {
    const section = /<h2\b[^>]*>\s*Sales List\s*<\/h2>/i.exec(html);
    if (!section) return [];
    const rows = html.slice(section.index + section[0].length).split(/<div\b[^>]*\bdata-ref=["']mix_item["'][^>]*>/i);
    rows.shift();
    const sales = [];
    for (const row of rows) {
      const time = timestamp(/\bactivity_entry_timestamp\b[^>]*>\s*(\d+)/i.exec(row)?.[1]);
      if (!time) continue;
      const id = idOf(/\bhref=["']\/itemsale\/(\d+)["']/i.exec(row)?.[1]);
      const text = row.replace(/<svg\b[\s\S]*?<\/svg>/gi, "").replace(/<[^>]*>/g, " ");
      const price = priceOf(/\bSale Price\s+(-?\d[\d,]*)/i.exec(text)?.[1]);
      const before = priceOf(/\bOld RAP\s+(\d[\d,]*)/i.exec(text)?.[1]);
      const after = priceOf(/\bNew RAP\s+(\d[\d,]*)/i.exec(text)?.[1]);
      sales.push({ id, time, price, before, after });
    }
    return sales;
  }

  function readSales(html) {
    const data = chartData(html);
    const listed = salesList(html);
    const count = priceOf(/>All Tracked Sales<\/div>\s*<div\b[^>]*>\s*([\d,]+)/i.exec(html)?.[1]);
    const sales = new Map();
    const saleKey = ({ id, time, price, before }) => id ?? `${time}:${price}:${before}`;
    if (Array.isArray(data?.timestamp_list)) {
      for (const [index, seconds] of data.timestamp_list.entries()) {
        const time = timestamp(seconds);
        if (!time) continue;
        const sale = {
          id: idOf(data.sale_id_list?.[index]), time, price: priceOf(data.sale_price_list?.[index]),
          before: amount(data.sale_rap_list?.[index]), after: null,
        };
        sales.set(saleKey(sale), sale);
      }
    }
    for (const sale of listed) {
      const key = saleKey(sale);
      const seriesSale = sales.get(key);
      sales.set(key, {
        ...sale, price: sale.price ?? seriesSale?.price ?? null,
        before: sale.before ?? seriesSale?.before ?? null,
      });
    }
    if (!sales.size && count !== 0 && data?.num_points !== 0) return { status: "unavailable" };
    return {
      status: "ok", count, checkedAt: Date.now(),
      sales: [...sales.values()].sort((a, b) => b.time - a.time || Number(b.id) - Number(a.id)),
    };
  }

  return { itemIndex, readSales };
})();
