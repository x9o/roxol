import assert from "node:assert/strict";
import { test } from "node:test";
import proofOverpay from "../../extension/shared/proof-overpay.js";

test("pools old and new caption proofs with the focal side consistently oriented", () => {
  const image = "https://nevos-extension.com/api/proofs/images/123456";
  const post = (index, content, attachments = [], timestamp = Date.UTC(2026, 10, 28)) => ({
    id: String(1500000000000000000n + BigInt(index)), content, attachments, timestamp,
  });
  const result = proofOverpay.summarize({
    item_name: "Focal Item",
    acronym: "FI",
    count: 8,
    results: [
      post(1, "FI / Other\n10k vs 11k", [image]),
      post(2, "Items: Other + Third v Focal Item (FI)\nValues: 13k v 10k", [], Date.UTC(2018, 0, 1)),
      post(3, "Other / FI\n9k vs 10k"),
      post(4, "FI / Other\n10k vs 11k", [image]),
      post(5, "Other / 2x FI\n25k vs 20k"),
      post(6, "FI / Other, FI\n10k vs 13k"),
      post(7, "FI / Other\n4k OP for FI"),
    ],
  }, {});
  assert.equal(result.median, 2000);
  assert.equal(result.medianPercent, 10);
  assert.equal(result.postCount, 7);
  assert.equal(result.unpricedPosts, 3);
  assert.equal(result.partial, true);
  assert.deepEqual(result.trades.map(({ net }) => net), [1000, -1000, 4000, 3000]);
  assert.equal(result.trades[3].date, "2018-01-01T00:00:00.000Z");
  assert.match(result.trades[0].discordUrl, /\/1500000000000000001$/);
  assert.deepEqual(result.trades[0].attachments, [image]);
  assert.deepEqual(result.trades[1].attachments, []);
  assert.equal(proofOverpay.isAttachment(`${image}?redirect=anything`), false);
});

test("keeps zero overpay and leaves screenshot-only or ambiguous captions unpriced", () => {
  const result = proofOverpay.summarize({ results: [
    { id: "1500000000000000000", content: "Other / Item\n6,000 / 6k" },
    { id: "1500000000000000001", content: "Other / Item\n6k OP" },
    { id: "1500000000000000002", attachments: ["screenshot-only"] },
    { id: "1500000000000000003", content: "Other / Item\n90 vs 80k" },
  ] }, { name: "Item" });
  assert.equal(result.median, 0);
  assert.equal(result.trades.length, 1);
  assert.equal(result.unpricedPosts, 3);
});
