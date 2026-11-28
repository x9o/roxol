import { text } from "node:stream/consumers";
import { pathToFileURL } from "node:url";
import market from "../../extension/background/public-market.js";
import overpay from "../../extension/shared/proof-overpay.js";
import { createNevosProofClient, downloadProofImage } from "../mcp/proofs.mjs";
import { createDiscordSearch, discordAttachmentKey } from "../mcp/discord-proofs.mjs";

const item = { kind: "asset", id: "398674411", key: "asset:398674411", name: "Black Iron Antlers" };
const screenshotSampleSize = 8;

export { discordAttachmentKey };

export async function readDiscordProofs(token, request = fetch) {
  const result = await createDiscordSearch(token, request)(["BIA", item.name]);
  return { ...result, status: result.reason && result.records.length ? "incomplete" : result.status };
}

async function checkDiscordImage(url) {
  return discordAttachmentKey(url) && downloadProofImage(url, {
    credentials: "omit", redirect: "error", signal: AbortSignal.timeout(8_000),
  });
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
  const readNevos = createNevosProofClient();
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
