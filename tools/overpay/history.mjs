import { setTimeout as delay } from "node:timers/promises";
import valuation from "../../extension/shared/trade-valuations.js";

export const { parseHistory, assignmentAt } = valuation;

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
