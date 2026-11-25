import { setTimeout as delay } from "node:timers/promises";

const origin = "https://www.rolimons.com";

async function read(url) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (response.ok) return response;
    if (response.status !== 429 || attempt >= 2) throw new Error("Rolimon's returned HTTP " + response.status);
    const header = response.headers.get("retry-after");
    const wait = !header ? 5000 * (attempt + 1) :
      /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
    if (wait > 30000) throw new Error("Rolimon's returned HTTP 429 with a retry delay over 30 seconds");
    await response.body?.cancel();
    await delay(Math.max(1000, wait || 5000));
  }
}

export async function catalog() {
  const data = await (await read("https://api.rolimons.com/items/v3/itemdetails")).json();
  if (!data.success || !data.assets || !data.bundles) throw new Error("Rolimon's item catalog unavailable.");
  return { asset: data.assets, bundle: data.bundles };
}

export function parseHistory(html, target, currentValue, source, trackedFrom) {
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

export function assignmentAt(history, from, through = from) {
  if (!history || !Number.isFinite(from) || !Number.isFinite(through) || through < from ||
      history.changes.some(({ time }) => time > from && time <= through)) return null;
  const change = history.changes.findLast(({ time }) => time <= from);
  if (change) return { value: change.after, effectiveAt: new Date(change.time).toISOString(), source: history.source };
  if (history.unvaluedFrom <= from) {
    return { value: null, effectiveAt: new Date(history.unvaluedFrom).toISOString(), source: history.source };
  }
  return null;
}

export async function getHistory(target, items) {
  const segment = target.kind === "bundle" ? "bundle-value-changes" : "item-value-changes";
  const source = origin + "/" + segment + "/" + target.id;
  const current = items[target.kind]?.[target.id]?.[3];
  await delay(600);
  const response = await read(source);
  return parseHistory(await response.text(), target, current, response.url);
}

export function priceAt(history, date, offsetMinutes) {
  if (!history) return null;
  const start = Date.parse(date);
  if (!Number.isFinite(start)) return null;
  const dateOnly = date.length === 10;
  // Without a known time zone, cover all plausible UTC times for the civil date.
  const low = dateOnly ? start - (offsetMinutes ?? 840) * 60000 : start;
  const high = dateOnly ? start - (offsetMinutes ?? -720) * 60000 + 86400000 - 1 : start;
  const change = history.changes.findLast((entry) => entry.time <= low);
  if (!Number.isSafeInteger(change?.after) || change.after <= 0 ||
      history.changes.some((entry) => entry.time > low && entry.time <= high)) return null;
  return { value: change.after, effectiveAt: new Date(change.time).toISOString(), source: history.source };
}
