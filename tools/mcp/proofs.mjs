import { readFile } from "node:fs/promises";
import { z } from "zod";
import targets from "../../extension/shared/market_targets.js";

const proofLink = /^https:\/\/discord\.com\/channels\/415246288779608064\/535250426061258753\/(\d{17,20})$/;
const id = z.string().regex(/^[1-9]\d{0,19}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/i);
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

  return async function readLiveProofs(item) {
    const source = `${baseUrl}/${item.id}`;
    if (item.kind !== "asset") return { source, status: "unsupported" };
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
        return unavailable("rate_limited");
      }
      if (!response.ok) return unavailable("http_error");

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
            typeof url === "string" && /^https:\/\/nevos-extension\.com\/api\/proofs\/images\/\d{5,32}$/.test(url)) : [],
        }];
      }).sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "") || b.postId.localeCompare(a.postId));
      if (!records.length) return unavailable("invalid_proof_response");
      return { source, status: "ok", records, count: data.count };
    } catch (error) {
      return unavailable(signal.aborted || error.name === "TimeoutError" ? "timeout" :
        error instanceof SyntaxError ? "invalid_proof_response" : "request_failed");
    }
  };
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
    return [{ postId: id, source: link, completedAtReported: date, offsetMinutes: offset ?? null,
      baskets, robux, robuxBasis: robuxBasis ?? null, evidenceSha256: hashes }];
  });
  records.sort((a, b) => b.completedAtReported.localeCompare(a.completedAtReported) || b.postId.localeCompare(a.postId));
  return { loadedAt: Date.now(), records };
}
