import market from "../../extension/background/public-market.js";
import targets from "../../extension/shared/market_targets.js";
import { proofOrigin, discordAttachment, downloadProofImage } from "./proofs.mjs";

const [, , guildId, channelId] = new URL(proofOrigin.url).pathname.split("/");
const endpoint = `https://discord.com/api/v9/guilds/${guildId}/messages/search`;
const cdnPath = new RegExp(`^/attachments/${channelId}/(\\d{17,20})/[^/]+$`);
const pageSize = 25;
const maxPages = 4;
const imageTypes = /^image\/(?:png|jpeg|webp|gif)$/i;

export function discordAttachmentKey(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === "https://cdn.discordapp.com" && !url.username && !url.password &&
      cdnPath.test(url.pathname) ? url.pathname : null;
  } catch {
    return null;
  }
}

function readHits(groups) {
  return groups.flatMap((group) => {
    if (!Array.isArray(group)) return [];
    const hits = group.length === 1 && group[0]?.hit === undefined ? group : group.filter((row) => row?.hit === true);
    return hits.flatMap((row) => {
      if (row?.channel_id !== channelId || typeof row.id !== "string" || !/^\d{17,20}$/.test(row.id)) return [];
      const timestamp = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
      const postedAt = new Date(Number.isFinite(timestamp) ? timestamp : Number((BigInt(row.id) >> 22n) + 1420070400000n))
        .toISOString();
      const attachments = (Array.isArray(row.attachments) ? row.attachments : []).flatMap((attachment) => {
        const url = attachment?.url;
        const type = attachment?.content_type;
        const key = discordAttachmentKey(url);
        return key && (typeof type === "string" ? imageTypes.test(type) : /\.(?:png|jpe?g|webp|gif)$/i.test(key))
          ? [url] : [];
      });
      return [{ postId: row.id, postedAt, content: typeof row.content === "string" ? row.content : null, attachments }];
    });
  });
}

export function createDiscordSearch(token, request = fetch) {
  let retryAt = 0;

  async function readPage(term, offset, signal) {
    const unavailable = (reason, httpStatus) => ({ status: "unavailable", reason, httpStatus });
    if (!token) return unavailable("no_discord_token");
    if (retryAt > Date.now()) return unavailable("rate_limited", 429);
    const query = new URLSearchParams({ channel_id: channelId, content: term, offset: String(offset),
      sort_by: "timestamp", sort_order: "desc" });
    let httpStatus;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await request(`${endpoint}?${query}`, {
          headers: { Authorization: token }, redirect: "error", signal,
        });
        httpStatus = response.status;
        if (!response.ok) {
          if (httpStatus === 429) {
            const header = response.headers.get("retry-after");
            const now = Date.now();
            const next = /^\d+(?:\.\d+)?$/.test(header ?? "") ? now + Number(header) * 1000 : Date.parse(header);
            retryAt = Math.max(retryAt, Number.isFinite(next) ? next : now + 60_000);
          }
          void response.body?.cancel().catch(() => {});
          if (httpStatus >= 500 && attempt === 0) continue;
          return unavailable(httpStatus === 429 ? "rate_limited" : "http_error", httpStatus);
        }
        const data = await response.json();
        if (!Array.isArray(data?.messages) || !Number.isSafeInteger(data.total_results) || data.total_results < 0) {
          return unavailable("invalid_proof_response", httpStatus);
        }
        return { status: "ok", httpStatus, totalHits: data.total_results, groups: data.messages.length,
          records: readHits(data.messages) };
      } catch (error) {
        return unavailable(signal.aborted || error.name === "TimeoutError" ? "timeout" :
          error instanceof SyntaxError ? "invalid_proof_response" : "request_failed", httpStatus);
      }
    }
  }

  return async (terms, onHit = () => {}) => {
    const signal = AbortSignal.timeout(20_000);
    const posts = new Map();
    const searches = [];
    let failure;
    let partial = false;
    for (const term of terms) {
      const search = { term, pages: 0, totalHits: null, httpStatus: null };
      searches.push(search);
      for (let page = 0; page < maxPages; page++) {
        const offset = page * pageSize;
        const result = await readPage(term, offset, signal);
        search.httpStatus = result.httpStatus;
        if (result.status !== "ok") {
          if (!failure || [401, 403, 429].includes(result.httpStatus)) failure = result;
          partial = true;
          break;
        }
        search.pages++;
        search.totalHits = result.totalHits;
        for (const post of result.records) {
          if (!posts.has(post.postId)) posts.set(post.postId, post);
          onHit(post);
        }
        if (!result.groups || offset + pageSize >= result.totalHits) break;
        if (page === maxPages - 1) partial = true;
      }
      if (failure?.httpStatus === 429 || failure?.httpStatus === 401 || failure?.httpStatus === 403 || signal.aborted) break;
    }
    const records = [...posts.values()];
    const successful = searches.some(({ pages }) => pages > 0);
    return {
      source: proofOrigin.url, status: successful ? "ok" : "unavailable", checkedAt: new Date().toISOString(),
      records, searches, partial,
      ...(failure && { reason: failure.reason, httpStatus: failure.httpStatus }),
    };
  };
}

const normalized = (text) => String(text ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const clean = (text) => typeof text === "string" ? text.trim().replace(/\s+/g, " ").slice(0, 160) : "";

export function createDiscordProofClient(env = process.env, {
  request = fetch, readItemFeed = market.readItemFeed, cacheMs = 120_000,
} = {}) {
  const token = env.ROXOL_DISCORD_TOKEN?.trim();
  const scan = createDiscordSearch(token, request);
  const results = new Map();
  const images = new Map();
  const refreshing = new Map();
  const unavailable = (reason) => ({ source: proofOrigin.url, status: "unavailable", reason });

  function attachmentReferences(post, terms) {
    return [...new Set(post.attachments.map((url) => {
      const [, attachmentId] = cdnPath.exec(discordAttachmentKey(url));
      const reference = `discord-attachment:${post.postId}:${attachmentId}`;
      images.delete(reference);
      images.set(reference, { url, terms });
      if (images.size > 4000) images.delete(images.keys().next().value);
      return reference;
    }))];
  }

  async function readLiveProofs(item, { itemName, itemAcronym } = {}) {
    if (!token) return unavailable("no_discord_token");
    const metadata = !itemName || !itemAcronym ? (await readItemFeed())?.get(targets.keyOf(item)) : null;
    const name = clean(itemName || metadata?.name);
    const acronym = clean(itemAcronym || metadata?.acronym);
    const terms = [...new Map([acronym, name].filter((term) => normalized(term) && !/^(?:op|vs?)$/i.test(term))
      .map((term) => [normalized(term), term])).values()];
    if (!terms.length) return unavailable("no_item_search_terms");
    const key = JSON.stringify(terms);
    const lookup = async () => {
      const read = await scan(terms);
      const needles = terms.map((term) => ` ${normalized(term)} `);
      const { records, ...details } = read;
      const matched = records.filter((post) => {
        const caption = ` ${normalized(post.content)} `;
        return needles.some((term) => caption.includes(term));
      }).map((post) => ({ ...post, attachments: attachmentReferences(post, terms) }));
      return { ...details, records: matched, count: matched.length };
    };
    return cacheMs ? market.cached(results, key) || market.remember(results, key, lookup(), 80,
      ({ partial }) => partial ? Math.min(cacheMs, 30_000) : cacheMs) : lookup();
  }

  async function readImage(reference) {
    if (!discordAttachment.test(reference)) return null;
    const known = images.get(reference);
    if (!known) return null;
    const download = (url) => downloadProofImage(url, { credentials: "omit", redirect: "error",
      signal: AbortSignal.timeout(8_000) }, request).catch(() => null);
    const image = await download(known.url);
    if (image) return image;

    const key = JSON.stringify(known.terms);
    if (!refreshing.has(key)) {
      refreshing.set(key, scan(known.terms, (post) => attachmentReferences(post, known.terms))
        .finally(() => refreshing.delete(key)));
    }
    await refreshing.get(key);
    const refreshed = images.get(reference);
    return refreshed && refreshed.url !== known.url ? download(refreshed.url) : null;
  }

  return Object.assign(readLiveProofs, { readImage });
}
