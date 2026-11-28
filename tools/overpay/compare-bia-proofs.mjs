import { text } from "node:stream/consumers";
import { pathToFileURL } from "node:url";
import market from "../../extension/background/public-market.js";
import overpay from "../../extension/shared/proof-overpay.js";
import { createProofClient, proofOrigin } from "../mcp/proofs.mjs";

const item = { kind: "asset", id: "398674411", key: "asset:398674411", name: "Black Iron Antlers" };
const [, , guildId, channelId] = new URL(proofOrigin.url).pathname.split("/");
const searchUrl = `https://discord.com/api/v9/guilds/${guildId}/messages/search`;
const attachmentPath = new RegExp(`^/attachments/${channelId}/\\d{17,20}/[^/]+$`);
const pageSize = 25;
const pagesPerTerm = 4;
const screenshotSampleSize = 8;

export function discordAttachmentKey(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.origin === "https://cdn.discordapp.com" && !url.username && !url.password &&
        attachmentPath.test(url.pathname)) {
      return url.pathname;
    }
  } catch {
    return null;
  }
  return null;
}

export async function readDiscordProofs(token, request = fetch) {
  const posts = new Map();
  const searches = [];
  for (const term of ["BIA", item.name]) {
    const search = { term, pages: 0, totalHits: null, httpStatus: null };
    searches.push(search);
    for (let page = 0; page < pagesPerTerm; page++) {
      const offset = page * pageSize;
      const query = new URLSearchParams({ channel_id: channelId, content: term, offset: String(offset),
        sort_by: "timestamp", sort_order: "desc" });
      const response = await request(`${searchUrl}?${query}`, {
        headers: { Authorization: token }, redirect: "error", signal: AbortSignal.timeout(20_000),
      });
      search.httpStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        return { status: "incomplete", searches, records: [...posts.values()] };
      }
      const data = await response.json();
      if (!Array.isArray(data.messages) || !Number.isSafeInteger(data.total_results)) {
        return { status: "invalid_response", searches, records: [...posts.values()] };
      }
      search.pages++;
      search.totalHits = data.total_results;
      for (const group of data.messages) {
        if (!Array.isArray(group)) continue;
        const hits = group.length === 1 && group[0]?.hit === undefined ? group : group.filter((row) => row?.hit === true);
        for (const row of hits) {
          if (row?.channel_id !== channelId || typeof row.id !== "string" || !/^\d{17,20}$/.test(row.id)) continue;
          const attachments = (Array.isArray(row.attachments) ? row.attachments : []).flatMap((attachment) => {
            const url = attachment?.url;
            const type = attachment?.content_type;
            const key = discordAttachmentKey(url);
            return key && (typeof type === "string" ? type.startsWith("image/") :
              /\.(?:png|jpe?g|webp|gif)$/i.test(key)) ? [url] : [];
          });
          posts.set(row.id, { postId: row.id, postedAt: row.timestamp, content: row.content, attachments });
        }
      }
      if (!data.messages.length || offset + pageSize >= data.total_results) break;
    }
  }
  return { status: "ok", searches, records: [...posts.values()] };
}

async function checkDiscordImage(url) {
  if (!discordAttachmentKey(url)) return false;
  const response = await fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(8_000) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return false;
  }
  const reader = response.body.getReader();
  const header = Buffer.alloc(12);
  let length = 0;
  try {
    while (length < header.length) {
      const { done, value } = await reader.read();
      if (done) return false;
      length += Buffer.from(value).copy(header, length);
    }
    return header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      header.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")) ||
      /^(?:GIF87a|GIF89a)$/.test(header.toString("ascii", 0, 6)) ||
      header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export async function summarizeSample(records, feed, checkImage, attachmentKey) {
  const ordered = [...records].sort((a, b) => b.postId.localeCompare(a.postId));
  const results = ordered.map(({ postId, postedAt, content, attachments }) => ({
    id: postId, timestamp: Date.parse(postedAt), content, attachments,
  }));
  const sample = overpay.summarize({ results, item_name: item.name, acronym: "BIA" }, item, feed, attachmentKey);
  const screenshotChecks = [];
  for (const row of ordered.filter(({ attachments }) => attachments.length).slice(0, screenshotSampleSize)) {
    const readable = await checkImage(row.attachments[0]).catch(() => false);
    screenshotChecks.push({ postId: row.postId, readable: Boolean(readable) });
  }
  return {
    posts: ordered.map(({ postId, postedAt, attachments }) => ({ postId, postedAt, imageCount: attachments.length })),
    pricedDowngrades: sample.trades.map(({ discordUrl, net }) => ({ postId: discordUrl.split("/").at(-1), net })),
    qualifyingProofCount: sample.qualifyingProofCount,
    median: sample.median,
    screenshotChecks,
  };
}

async function main() {
  if (!process.argv.slice(2).every((arg) => arg === "--nevos-only")) throw new Error("Unexpected argument");
  const nevosOnly = process.argv.includes("--nevos-only");
  try {
    process.loadEnvFile(new URL("../mcp/.env", import.meta.url));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const token = nevosOnly ? null : process.env.ROXOL_DISCORD_TOKEN?.trim() ||
    (!process.stdin.isTTY && (await text(process.stdin)).trim());
  if (!nevosOnly && !token) {
    console.error("Set ROXOL_DISCORD_TOKEN in tools/mcp/.env or pass the Discord credential on standard input.");
    process.exitCode = 1;
    return;
  }
  const readNevos = createProofClient();
  const [discord, nevos, feed] = await Promise.all([
    token ? readDiscordProofs(token).catch(() => ({ status: "request_failed", records: [] })) : null,
    readNevos(item, { itemName: item.name }),
    market.readItemFeed(),
  ]);
  const [discordSample, nevosSample] = await Promise.all([
    discord?.records.length ? summarizeSample(discord.records, feed, checkDiscordImage, discordAttachmentKey) : null,
    nevos.records?.length ? summarizeSample(nevos.records, feed, readNevos.readImage) : null,
  ]);
  const discordPosts = new Map(discord?.records.map((row) => [row.postId, row]));
  const shared = (nevos.records ?? []).filter(({ postId }) => discordPosts.has(postId));
  console.log(JSON.stringify({
    item,
    rolimonsItemPricesAvailable: Boolean(feed?.has(item.key)),
    publishedNevosBaselineCount: 12,
    discord: discord && { status: discord.status, searches: discord.searches, sample: discordSample },
    nevos: { status: nevos.status, httpStatus: nevos.httpStatus, reason: nevos.reason,
      providerCount: nevos.count, sample: nevosSample },
    comparison: discordSample && nevosSample && {
      sharedPostIds: shared.map(({ postId }) => postId),
      sharedPostsWithDifferentCaptions: shared.filter(({ postId, content }) =>
        discordPosts.get(postId).content !== content).map(({ postId }) => postId),
    },
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Proof comparison failed. Check Node.js, MCP dependencies, and the local configuration.");
    process.exitCode = 1;
  });
}
