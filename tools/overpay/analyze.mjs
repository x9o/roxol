import path from "node:path";
import { dataDir, readJson, saveJson } from "./store.mjs";
import { nameIndex, parsePost, submittedOverpay } from "./parse.mjs";
import { catalog, getHistory, priceAt } from "./history.mjs";
import { aggregate, deduplicate, priceTarget, shapeFor, validBasket } from "./stats.mjs";
import { spawnSync } from "node:child_process";

const saved = await readJson(path.join(dataDir, "messages.json"));
const reviews = await readJson(path.join(dataDir, "reviews.json"), {});
const items = await catalog();
const index = nameIndex(items);
const histories = new Map();
const cachePath = path.join(dataDir, "history-cache.json");
const cached = await readJson(cachePath, {});
const cacheAge = 6 * 60 * 60 * 1000;
const pricingErrors = {};
const rows = [];
const completed = [];
const idKey = ({ kind, id }) => kind + ":" + id;

for (const message of Object.values(saved.messages)) {
  const parsed = parsePost(message, index);
  const reviewEntries = Array.isArray(reviews[message.id]) ? reviews[message.id] : [reviews[message.id]].filter(Boolean);
  const evidence = message.attachments ?? [];
  const row = { id: message.id, link: message.link, postedAt: message.postedAt, editedAt: message.editedAt,
    edited: message.edited, editedAtPrecision: message.editedAtPrecision,
    parsed, evidence, reviews: reviewEntries, submittedOverpay: submittedOverpay(parsed, reviewEntries[0]?.targetSide) };
  rows.push(row);
  if (process.argv.includes("--ocr") && !reviewEntries.length && evidence.length) {
    row.ocr = evidence.map(({ file }) => {
      const result = spawnSync("tesseract", [path.join(dataDir, file), "stdout"], { encoding: "utf8", windowsHide: true });
      if (result.error) throw new Error("The --ocr option requires Tesseract on PATH.", { cause: result.error });
      return result.status === 0 ? result.stdout.trim() : null;
    });
  }
  for (const review of reviewEntries) {
    if (review.completed !== true || !evidence.length) continue;
    if (!evidence.some(({ sha256 }) => sha256 === review.evidenceSha256)) {
      row.status = "evidence-needs-review";
      continue;
    }
    const date = review.date ?? (parsed.dates.length === 1 ? parsed.dates[0] : null);
    const offset = review.offsetMinutes;
    const participants = review.participants ?? [parsed.fields.sender, parsed.fields.receiver];
    if (typeof date !== "string" || !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d))?$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || Date.parse(date) > Date.parse(message.postedAt) + 86400000 ||
        (offset !== undefined && (!Number.isInteger(offset) || offset < -720 || offset > 840)) ||
        !Array.isArray(participants) || participants.length !== 2 ||
        !participants.every((name) => typeof name === "string" && /^[a-z\d_]{1,20}$/i.test(name)) ||
        !Array.isArray(review.baskets) || review.baskets.length !== 2 || !review.baskets.every(validBasket) ||
        !Array.isArray(review.robux) || review.robux.length !== 2 ||
        !review.robux.every((amount) => Number.isSafeInteger(amount) && amount >= 0)) {
      row.status = "needs-review";
      continue;
    }
    completed.push({ id: message.id, link: message.link, date, offset, participants, baskets: review.baskets,
      robux: review.robux, robuxBasis: review.robuxBasis, tradeId: review.tradeId, hashes: [review.evidenceSha256] });
  }
}

const counts = {
  messages: rows.length, moderation: rows.filter(({ parsed }) => parsed.moderation).length,
  usableText: rows.filter(({ parsed }) => parsed.submitted?.every(Number.isSafeInteger) || parsed.baskets.flat().some(({ matches }) => matches.length === 1)).length,
  postsWithEvidence: rows.filter(({ evidence }) => evidence.length).length,
  reviewedComplete: completed.length,
  duplicates: 0, conflictingGroups: 0, uniqueCompleted: 0, robuxTrades: 0, isolatedTargets: 0,
  fullyPriced: 0, eligibleTrades: 0, roPostCrossChecks: rows.flatMap(({ reviews }) => reviews)
    .filter(({ roPost }) => ["match", "discrepancy"].includes(roPost?.result)).length,
};
const samples = new Map();
const pricedTrades = [];
const byItem = {};
const groups = deduplicate(completed);
counts.duplicates = completed.length - groups.length;
for (const trade of groups) {
  if (trade.conflict) {
    counts.conflictingGroups++;
    pricedTrades.push({ ...trade, status: "conflict" });
    continue;
  }
  counts.uniqueCompleted++;
  const hasRobux = trade.robux.some(Boolean);
  if (hasRobux) counts.robuxTrades++;
  const prices = [];
  const keys = new Set();
  for (const basket of trade.baskets) {
    const values = [];
    for (const item of basket) {
      const key = idKey(item);
      keys.add(key);
      if (!histories.has(key)) {
        const current = items[item.kind]?.[item.id]?.[3] ?? null;
        const entry = cached[key];
        if (entry?.current === current && Date.now() - entry.checkedAt < cacheAge) {
          histories.set(key, entry.history);
        } else {
          try {
            const history = await getHistory(item, items);
            histories.set(key, history);
            cached[key] = { current, checkedAt: Date.now(), history };
          } catch (error) {
            pricingErrors[key] = error.message;
            histories.set(key, null);
          }
        }
      }
      values.push({ ...item, price: priceAt(histories.get(key), trade.date, trade.offset) });
    }
    prices.push(values);
  }
  const shapes = trade.baskets.map((_, side) => shapeFor(trade.baskets, side));
  const complete = prices.flat().every(({ price }) => price);
  if (complete) counts.fullyPriced++;
  for (const key of keys) {
    const coverage = byItem[key] ??= { completed: 0, isolated: 0, fullyPriced: 0, eligible: 0 };
    coverage.completed++;
    if (complete) coverage.fullyPriced++;
  }
  const priced = { ...trade, prices, shapes, targets: [] };
  pricedTrades.push(priced);
  let eligible = false;
  for (const [side, shape] of shapes.entries()) {
    if (!shape) continue;
    counts.isolatedTargets++;
    const item = trade.baskets[side][0];
    const key = idKey(item);
    byItem[key].isolated++;
    if (!complete || hasRobux) continue;
    byItem[key].eligible++;
    eligible = true;
    const quote = priceTarget(prices, side);
    priced.targets.push({ key, side, shape, ...quote });
    const group = samples.get(key) ?? {};
    (group[shape] ??= []).push({ time: Date.parse(trade.date), overpay: quote.overpay, links: trade.links });
    samples.set(key, group);
  }
  if (eligible) counts.eligibleTrades++;
}

const now = Date.now();
const snapshot = {
  version: 1, lastCollection: saved.lastCollection, generatedAt: new Date(now).toISOString(),
  items: Object.fromEntries([...samples].map(([key, shapes]) => [key, Object.fromEntries(
    Object.entries(shapes).map(([shape, values]) => [shape, aggregate(values, now)]),
  )])),
};
await saveJson(path.join(dataDir, "pilot.json"), { counts, byItem, pricingErrors, rows, pricedTrades });
await saveJson(path.join(dataDir, "benchmarks.json"), snapshot);
await saveJson(cachePath, cached);
console.log(JSON.stringify({ counts, byItem, pricingErrors }, null, 2));
