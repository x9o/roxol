import assert from "node:assert/strict";
import { test } from "node:test";
import { discordAttachmentKey, readDiscordProofs, summarizeSample } from "./compare-bia-proofs.mjs";

const channel = "535250426061258753";
const image = `https://cdn.discordapp.com/attachments/${channel}/1500000000000000000/proof.png`;
const postedAt = "2026-11-29T00:00:00.000Z";

test("reads bounded Discord search pages and keeps only channel hits and valid image attachments", async () => {
  const proof = { id: "1500000000000000001", channel_id: channel, hit: true, timestamp: postedAt,
    content: "full caption", attachments: [{ url: image }, { url: image.replace("cdn.discordapp.com", "example.com") }] };
  const calls = [];
  const request = async (url, options) => {
    const params = new URL(url).searchParams;
    calls.push([params.get("content"), params.get("offset")]);
    assert.equal(params.get("channel_id"), channel);
    assert.equal(options.headers.Authorization, "fixture");
    if (calls.length === 3) return new Response(null, { status: 429 });
    return Response.json({ total_results: 26, messages: [[
      { ...proof, id: "1500000000000000002", hit: false }, proof,
      { ...proof, id: "1500000000000000003", channel_id: "other" },
    ]] });
  };
  const result = await readDiscordProofs("fixture", request);
  assert.equal(result.status, "incomplete");
  assert.deepEqual(calls, [["BIA", "0"], ["BIA", "25"], ["Black Iron Antlers", "0"]]);
  assert.deepEqual(result.records, [{ postId: proof.id, postedAt, content: proof.content, attachments: [image] }]);
});

test("signed URL changes do not double-count the same screenshot in the Marketplace median", async () => {
  const feed = new Map([
    ["asset:398674411", { name: "Black Iron Antlers", acronym: "BIA", value: 10000 }],
    ["asset:2", { name: "Smaller", value: 7000 }],
    ["asset:3", { name: "Add", value: 1000 }],
  ]);
  const records = ["1500000000000000001", "1500000000000000002"].map((postId) => ({
    postId, postedAt, content: "BIA / Smaller + Add\n10k vs 11k", attachments: [`${image}?sig=${postId}`],
  }));
  const result = await summarizeSample(records, feed, async () => true, discordAttachmentKey);
  assert.equal(result.qualifyingProofCount, 1);
  assert.equal(result.median, 1000);
  assert.equal(result.screenshotChecks.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /sig=|Smaller/);
});
