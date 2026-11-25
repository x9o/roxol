import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { browserTargets, connect, launchEdge, waitFor } from "./edge.mjs";
import { readJson, saveJson } from "./store.mjs";
import { coverage, normalizeTrades, parseItemProfile, resolveTrades } from "./trade-valuations.mjs";
import { validateTrades } from "./trade-validation.mjs";
import { itemOverpay, severelyImbalanced } from "./item-overpay.mjs";

const [input, output, flag, completed, ...extra] = process.argv.slice(2);
const sameFile = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
if (!input || !output || sameFile(input, output) || extra.length ||
    (flag !== undefined && (flag !== "--completed" || !completed || sameFile(completed, output)))) {
  throw new Error("Usage: node tools/overpay/resolve-trades.mjs <trades.json> <report.json> [--completed <pilot.json>]");
}

const cacheDir = process.env.ROXOL_TRADE_VALUATION_CACHE ??
  path.join(process.env.LOCALAPPDATA, "Roxol", "trade-valuations");
const cacheAge = 6 * 60 * 60 * 1000;
const source = await readJson(input);
const excludedRecords = [];
const trades = normalizeTrades(source, excludedRecords);
const normalizationExclusions = Object.fromEntries(Object.entries(Object.groupBy(excludedRecords, ({ reason }) => reason))
  .map(([reason, entries]) => [reason, entries.length]));
const validation = completed ? validateTrades(trades, await readJson(completed)) : null;
const needed = new Map();
for (const trade of trades) {
  const times = [trade.firstObservedAt, trade.lastObservedAt].map(Date.parse).filter(Number.isFinite);
  for (const item of [...trade.sideA, ...trade.sideB]) {
    if (!item.assetId) continue;
    const itemTime = Date.parse(item.observedAt);
    needed.set(item.assetId, Math.max(needed.get(item.assetId) ?? 0, ...times, itemTime || 0));
  }
}

const profiles = new Map();
const profileErrors = {};
const profileFailures = {};
const requests = { cacheHits: 0, profileRequests: 0 };
let browser;
let worker;
let rateLimited = false;

async function readProfile(url) {
  if (!worker) {
    const profile = await mkdtemp(path.join(tmpdir(), "roxol-trade-valuations-"));
    const extension = fileURLToPath(new URL("../../extension", import.meta.url));
    browser = launchEdge(profile, [
      "--headless=new", "--disable-gpu", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
      `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "about:blank",
    ]);
    const targets = await browserTargets(profile, browser);
    worker = await connect(await waitFor(async () => (await targets()).find(
      (target) => target.type === "service_worker" && target.url.endsWith("/background/background.js"),
    ), "Roxol service worker"));
  }
  if (requests.profileRequests) await delay(2200);
  requests.profileRequests++;
  return worker.evaluate(async (url) => {
    try {
      const response = await fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(12000) });
      return { status: response.status, html: response.ok ? await response.text() : null };
    } catch (error) {
      return { error: error.message };
    }
  }, url);
}

try {
  for (const [id, latestTrade] of needed) {
    const file = path.join(cacheDir, `${id}.json`);
    const url = `https://www.rolimons.com/item/${id}`;
    const cached = await readJson(file, null);
    const reusable = cached?.version === 1 && cached.profile?.source === url && cached.profile.history &&
      Number.isSafeInteger(cached.profile.checkedAt) && Array.isArray(cached.profile.rap);
    if (reusable && cached.profile.checkedAt >= latestTrade &&
        Date.now() - cached.profile.checkedAt < cacheAge) {
      profiles.set(id, cached.profile);
      requests.cacheHits++;
      continue;
    }
    if (reusable) profiles.set(id, cached.profile);
    if (rateLimited) {
      profileErrors[id] = "Deferred after Rolimon's rate limit. Rerun later to resume.";
      profileFailures[id] = { reason: "deferred-provider-cooldown", httpStatus: null, triggerHttpStatus: 429 };
      continue;
    }
    try {
      const { status, html, error } = await readProfile(url);
      rateLimited = status === 429;
      if (error || !html) {
        profileFailures[id] = { reason: error ? "profile-request-error" : "profile-http-error", httpStatus: status ?? null };
        throw new Error(error ?? `Rolimon's returned HTTP ${status}`);
      }
      const profile = parseItemProfile(html, id, url, Date.now());
      if (!profile) {
        profileFailures[id] = { reason: "profile-unrecognized", httpStatus: status };
        throw new Error("Unrecognized Rolimon's item profile");
      }
      if (profile.history) {
        await saveJson(file, { version: 1, profile });
        profiles.set(id, profile);
      } else {
        if (!reusable) profiles.set(id, profile);
        profileErrors[id] = "Incomplete Rolimon's assigned Value history.";
        profileFailures[id] = { reason: "incomplete-assigned-value-history", httpStatus: status };
      }
    } catch (error) {
      if (!worker) throw error;
      profileErrors[id] = error.message;
    }
  }
} finally {
  worker?.close();
  browser?.kill();
}

const resolved = resolveTrades(trades, profiles).map((trade) => {
  const proof = validation?.matched.get(trade.tradeId);
  const { sideATotal, sideBTotal } = trade.historicalItemOnlyOverpay;
  const priced = [...trade.sideA, ...trade.sideB].every((item) => item.historical?.value > 0);
  return {
    ...trade,
    robux: proof?.status === "copy-corroborated" ? proof.robux : trade.robux,
    severelyImbalanced: priced && severelyImbalanced(sideATotal, sideBTotal),
  };
});
const summary = coverage(resolved);
const generatedAt = Date.now();
await saveJson(output, {
  source: "RoUtility",
  sourceUrl: source.sourceUrl ?? null,
  assetId: source.assetId ?? null,
  pages: source.pages ?? null,
  inputRecords: source.trades.length,
  generatedAt: new Date(generatedAt).toISOString(),
  overpayPerspective: "Side A receiving side B",
  coverage: summary,
  requests,
  profileErrors,
  profileFailures,
  normalizationExclusions,
  excludedRecords,
  validation: validation ? { summary: validation.summary, proofs: validation.proofs } : null,
  itemOverpay: itemOverpay(resolved, generatedAt),
  trades: resolved,
});
console.log(JSON.stringify({ coverage: summary, requests, profileErrors }, null, 2));
