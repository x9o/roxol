import { readFile } from "node:fs/promises";
import { z } from "zod";
import targets from "../../extension/shared/market_targets.js";
import market from "../../extension/background/public-market.js";

const proofLink = /^https:\/\/discord\.com\/channels\/415246288779608064\/535250426061258753\/(\d{17,20})$/;
export const proofImage = /^https:\/\/nevos-extension\.com\/api\/proofs\/images\/(\d{5,32})$/;
const nevosNetworkRejection = "Proofs are not available from proxy or datacenter networks.";
const id = z.string().regex(/^[1-9]\d{0,19}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/i);
const faceMapUrl = "https://api.rolimons.com/items/v1/faceassetbundlemap";
const item = z.object({
  kind: z.enum(["asset", "bundle"]),
  id,
  quantity: z.number().int().positive(),
  serial: id.nullish(),
});
const row = z.object({
  id: z.string(),
  link: z.string(),
  date: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
  offset: z.number().int().min(-720).max(840).nullish(),
  baskets: z.tuple([z.array(item).min(1).max(20), z.array(item).min(1).max(20)]),
  robux: z.tuple([z.number().int().nonnegative().nullable(), z.number().int().nonnegative().nullable()]),
  robuxBasis: z.string().max(80).nullish(),
  hashes: z.array(hash).min(1).max(20),
});

async function readNevosForbiddenMessage(body) {
  if (!body) return undefined;
  const reader = body.getReader();
  const buffer = new Uint8Array(4096);
  let length = 0;
  try {
    while (length < buffer.length) {
      const { done, value } = await reader.read();
      if (done) {
        const data = JSON.parse(new TextDecoder().decode(buffer.subarray(0, length)));
        // Return only the known message. An upstream error body could contain credentials.
        return data?.error === nevosNetworkRejection ? nevosNetworkRejection : undefined;
      }
      const part = value.subarray(0, buffer.length - length);
      buffer.set(part, length);
      length += part.length;
    }
  } catch {
    // Keep the HTTP status if the error body fails to read or is not JSON.
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export function createProofClient(env = process.env) {
  const baseUrl = (env.ROXOL_PROOFS_URL || "https://nevos-extension.com/api/proofs/search").replace(/\/+$/, "");
  const token = env.ROXOL_PROOFS_TOKEN?.trim();
  const mode = env.ROXOL_PROOFS_SEC_FETCH_MODE || "cors";
  const headers = {
    Accept: env.ROXOL_PROOFS_ACCEPT || "application/json",
    "Content-Type": env.ROXOL_PROOFS_CONTENT_TYPE || "application/json",
    "From-Extension": env.ROXOL_PROOFS_FROM_EXTENSION || "1",
    "X-Nte-Client": token,
    Origin: env.ROXOL_PROOFS_ORIGIN || "chrome-extension://domfhhikblcjiionldboaapeigejijic",
    "User-Agent": env.ROXOL_PROOFS_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36 Edg/158.0.0.0",
    "Sec-Fetch-Dest": env.ROXOL_PROOFS_SEC_FETCH_DEST || "empty",
    "Sec-Fetch-Mode": mode,
    "Sec-Fetch-Site": env.ROXOL_PROOFS_SEC_FETCH_SITE || "none",
  };
  let retryAt = 0;

  async function readLiveProofs(item, { allowBundle = false } = {}) {
    const source = `${baseUrl}/${item.id}`;
    if (item.kind !== "asset" && !allowBundle) return { source, status: "unsupported" };
    if (!token) return { source, status: "unavailable", reason: "no_nevos_client_token" };
    if (retryAt > Date.now()) return { source, status: "unavailable", httpStatus: 429, reason: "rate_limited" };

    const signal = AbortSignal.timeout(20_000);
    let httpStatus;
    const unavailable = (reason) => ({ source, status: "unavailable", httpStatus, reason });
    try {
      // Node derives the outgoing Sec-Fetch-Mode from the fetch mode.
      const response = await fetch(source, { method: "POST", headers, mode, redirect: "error", signal });
      httpStatus = response.status;
      if (httpStatus === 429) {
        const retryAfter = response.headers.get("retry-after");
        const now = Date.now();
        const next = /^\d+$/.test(retryAfter ?? "") ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter);
        retryAt = Math.max(retryAt, Number.isFinite(next) ? next : now + 60_000);
        void response.body?.cancel().catch(() => {});
        return unavailable("rate_limited");
      }
      if (!response.ok) {
        const failure = unavailable("http_error");
        if (httpStatus === 403) {
          const message = await readNevosForbiddenMessage(response.body);
          if (message) return { ...failure, message };
        } else {
          void response.body?.cancel().catch(() => {});
        }
        return failure;
      }

      const data = await response.json();
      if (data?.source?.trim?.() === "edge-cache" || !Array.isArray(data?.results) ||
          (data.item_id != null && data.item_id !== "" && targets.idOf(data.item_id) !== item.id)) {
        return unavailable("invalid_proof_response");
      }
      if (!data.results.length) return unavailable("empty_proof_response");

      const records = data.results.flatMap((row) => {
        if (typeof row?.id !== "string" || !/^\d{17,20}$/.test(row.id)) return [];
        const timestamp = Number(row.timestamp) || Number((BigInt(row.id) >> 22n) + 1420070400000n);
        return [{
          postId: row.id,
          postedAt: timestamp > 0 && timestamp < 8.64e15 ? new Date(timestamp).toISOString() : null,
          content: typeof row.content === "string" ? row.content : null,
          attachments: Array.isArray(row.attachments) ? row.attachments.filter((url) =>
            typeof url === "string" && proofImage.test(url)) : [],
        }];
      }).sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "") || b.postId.localeCompare(a.postId));
      if (!records.length) return unavailable("invalid_proof_response");
      return { source, status: "ok", records, count: data.count };
    } catch (error) {
      return unavailable(signal.aborted || error.name === "TimeoutError" ? "timeout" :
        error instanceof SyntaxError ? "invalid_proof_response" : "request_failed");
    }
  }

  async function readImage(url) {
    if (!token || !proofImage.test(url)) return null;
    const response = await fetch(url, {
      headers: { ...headers, Accept: "image/*" }, mode, redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 5 * 1024 * 1024) return null;
        chunks.push(value);
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    const bytes = Buffer.concat(chunks);
    const mime = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ? "png"
      : bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")) ? "jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
    return mime ? { bytes, mime } : null;
  }

  return Object.assign(readLiveProofs, { readImage });
}

export function indexProof(index, record, baskets) {
  for (const key of new Set(baskets.flat().filter(({ id }) => id).map(targets.keyOf))) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(record);
  }
}

export function createFaceAliases() {
  const cache = new Map();
  return async () => market.cached(cache, faceMapUrl) || market.remember(cache, faceMapUrl,
    market.request(faceMapUrl).then(({ data }) => {
      const source = data?.face_asset_bundle_map;
      if (!source || typeof source !== "object" || Array.isArray(source)) return null;
      const aliases = new Map();
      for (const [assetId, value] of Object.entries(source)) {
        const bundleId = targets.idOf(value);
        if (!id.safeParse(assetId).success || !bundleId) continue;
        const asset = { kind: "asset", id: assetId };
        const bundle = { kind: "bundle", id: bundleId };
        aliases.set(targets.keyOf(asset), [bundle]);
        const key = targets.keyOf(bundle);
        if (!aliases.has(key)) aliases.set(key, []);
        aliases.get(key).push(asset);
      }
      return aliases;
    }).catch(() => null), 1, 30 * 60_000);
}

const received = (amount) => Math.floor(amount / 10) * 7 + Math.round((amount % 10) * 7 / 10);

function grossFromCredit(credited) {
  const estimate = Math.round(credited / 0.7);
  const matches = [estimate - 1, estimate, estimate + 1]
    .filter((gross) => Number.isSafeInteger(gross) && gross > 0 && received(gross) === credited);
  return matches.length === 1 ? matches[0] : null;
}

export function proofRobux(baskets, payments, itemTotals = []) {
  const robux = payments.map(({ amount, basis }) => {
    const inferred = basis === "after_fee" && amount > 0 ? grossFromCredit(amount) : null;
    const offered = amount === 0 || basis === "offered" ? amount : inferred;
    const credited = amount === 0 || basis === "after_fee" ? amount : offered === null ? null : received(offered);
    return { amount, basis, offered, credited, ...(inferred === null ? {} : { offeredInferred: true }) };
  });
  const subtract = (incoming, outgoing) => incoming == null || outgoing == null ? null : incoming - outgoing;
  const netRobux = robux.map((outgoing, side) => subtract(robux[1 - side].credited, outgoing.offered));
  const creditedDifference = subtract(robux[1].credited, robux[0].credited);
  const totals = (field) => baskets.map((basket, side) => {
    const shownTotal = itemTotals[side]?.[field] ?? null;
    if (basket.some((item) => item[field] == null || item.quantity == null)) return shownTotal;
    const sum = basket.reduce((total, item) => total + item[field] * item.quantity, 0);
    return shownTotal === null || shownTotal === sum ? sum : null;
  });
  const difference = ([a, b]) => [subtract(b, a), subtract(a, b)].map((items, side) =>
    items == null || netRobux[side] == null ? null : items + netRobux[side]);
  return { robux, netRobux, creditedDifference, netRap: difference(totals("rap")), netValue: difference(totals("value")),
    netDisplayedPrice: difference(totals("displayedPrice")) };
}

export async function loadProofs(file) {
  if (!file) return null;
  const document = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(document?.pricedTrades)) throw new Error("Proof export must contain a pricedTrades array.");
  const records = document.pricedTrades.flatMap((entry, index) => {
    if (entry?.conflict || entry?.status === "conflict") return [];
    const parsed = row.safeParse(entry);
    if (!parsed.success || proofLink.exec(parsed.data.link)?.[1] !== parsed.data.id) {
      throw new Error(`Invalid reviewed public proof at index ${index}.`);
    }
    const { id, link, date, offset, baskets, robux, robuxBasis, hashes } = parsed.data;
    const basis = /^(offered|gross|before_fee)$/.test(robuxBasis ?? "") ? "offered"
      : /^(net|after_fee|after_30_percent_fee)$/.test(robuxBasis ?? "") ? "after_fee" : "unknown";
    return [{ postId: id, source: link, completedAtReported: date, offsetMinutes: offset ?? null,
      baskets, robux, robuxBasis: robuxBasis ?? null, evidenceSha256: hashes,
      afterFees: proofRobux(baskets, robux.map((amount) => ({ amount, basis }))) }];
  });
  records.sort((a, b) => b.completedAtReported.localeCompare(a.completedAtReported) || b.postId.localeCompare(a.postId));
  const byItem = new Map();
  for (const record of records) indexProof(byItem, record, record.baskets);
  return { loadedAt: Date.now(), records, byItem };
}
