import assert from "node:assert/strict";
import { test } from "node:test";
import proofOverpay from "../../extension/shared/proof-overpay.js";

const image = "https://nevos-extension.com/api/proofs/images/123456";
const item = { key: "asset:1", name: "Focal Item" };
const feed = new Map([
  [item.key, { name: item.name, acronym: "FI", value: 10000 }],
  ["asset:2", { name: "Smaller", value: 7000 }],
  ["asset:3", { name: "Add", rap: 1000 }],
  ["asset:4", { name: "Peer", value: 10000 }],
  ["asset:5", { name: "Bigger", value: 12000 }],
  ["asset:6", { name: "Third", value: 4000 }],
  ["asset:7", { name: "Large add", value: 5000 }],
]);
const post = (index, content, attachments = [], timestamp = Date.UTC(2026, 10, 28)) => ({
  id: String(1500000000000000000n + BigInt(index)), content, attachments, timestamp,
});

test("pools all dates and orients the full baskets around the focal owner", () => {
  const result = proofOverpay.summarize({
    count: 7,
    results: [
      post(1, "FI + Add / Smaller + Third\n11k vs 12k", [image]),
      post(2, "Items: Smaller + Third v Focal Item (FI)\nValues: 13k v 10k", [], Date.UTC(2018, 0, 1)),
      post(3, "FI / Smaller + Third\n10k vs 9k"),
      post(4, "FI + Add / Smaller + Third\n11k vs 12k", [image]),
      post(5, "2x Add + Third / FI\n10k vs 10k"),
      post(5, "2x Add + Third / FI\n10k vs 10k"),
    ],
  }, item, feed);
  assert.equal(result.median, 1000);
  assert.equal(result.postCount, 5);
  assert.equal(result.unpricedPosts, 1);
  assert.equal(result.partial, true);
  assert.deepEqual(result.trades.map(({ net }) => net), [1000, -1000, 0, 3000]);
  assert.equal(result.trades[3].date, "2018-01-01T00:00:00.000Z");
  assert.match(result.trades[0].discordUrl, /\/1500000000000000001$/);
  assert.deepEqual(result.trades[0].attachments, [image]);
  assert.equal(proofOverpay.isAttachment(`${image}?redirect=anything`), false);
});

test("takes the median of the OP magnitudes and preserves the signed evidence", () => {
  const result = proofOverpay.summarize({ results: [
    post(1, "FI / Smaller + Third\n471k vs 495k"),
    post(2, "Smaller + Third / FI\n570k vs 600k"),
  ] }, item, feed);
  assert.equal(result.median, 27000);
  assert.deepEqual(result.trades.map(({ net }) => net), [24000, -30000]);
});

test("credits incoming Robux after fees and debits all outgoing Robux", () => {
  const result = proofOverpay.summarize({ results: [
    post(1, "Smaller 4,001 Robux / FI + Add + 200 RBX\nItem totals: 7.5k vs 11k"),
    post(2, "FI / Smaller + Third + 500 Robux\nItem-only values: 10k / 11k"),
    post(3, "FI + Add + 300 Robux / Smaller + Third\nItem values: 11k vs 11k"),
  ] }, item, feed);
  assert.deepEqual(result.trades.map(({ net }) => net), [-899, 1350, -300]);
  assert.equal(result.median, 899);
  assert.deepEqual(result.trades[0], {
    net: -899,
    given: "FI + Add + 200 RBX",
    opposite: "Smaller 4,001 Robux",
    givenValue: 11000,
    receivedValue: 7500,
    outgoingRobux: 200,
    incomingRobux: 2801,
    incomingRobuxOffered: 4001,
    attachments: [],
    discordUrl: "https://discord.com/channels/415246288779608064/535250426061258753/1500000000000000001",
    date: "2026-11-28T00:00:00.000Z",
  });
});

test("excludes sideways swaps, upgrades and ambiguous evidence", () => {
  const result = proofOverpay.summarize({ results: [
    post(1, "FI / Peer\n10k vs 10k"),
    post(2, "FI / Smaller\n10k vs 9k"),
    post(3, "FI / Peer + 1k Robux\nItem totals: 10k vs 10k"),
    post(4, "FI / Bigger + Add\n10k vs 13k"),
    post(5, "FI + Large add / Smaller + Third\n15k vs 11k"),
    post(6, "FI / Smaller + FI\n10k vs 17k"),
    post(7, "2x FI / Smaller + Third\n20k vs 11k"),
    post(8, "FI / Smaller + Third\n2k OP for FI"),
    post(9, "FI / Smaller + 4k Robux\n10k vs 11k"),
    post(10, "FI / Smaller + Third\n10k vs 11k\nValues: 10k vs 13k"),
    post(11, "FI / Smaller + Third\n90 vs 80"),
    post(12, "FI / Smaller + Unknown\n10k vs 9k"),
    post(13, "", [image]),
    post(14, "FI / Smaller + Third\n10k vs 900"),
  ] }, item, feed);
  assert.equal(result.median, null);
  assert.equal(result.trades.length, 0);
  assert.equal(result.unpricedPosts, 14);
});
