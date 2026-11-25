import test from "node:test";
import assert from "node:assert/strict";
import { dateCandidates, nameIndex, parsePost, submittedOverpay } from "./parse.mjs";
import { parseHistory, priceAt } from "./history.mjs";
import { aggregate, deduplicate, priceTarget, shapeFor } from "./stats.mjs";

const item = (id, quantity = 1) => ({ kind: "asset", id, quantity });
const index = nameIndex({ asset: {
  4390891467: ["Ice Valkyrie", "Ice Valk"], 19027209: ["Perfectly Legitimate Business Hat", "Legit"],
  20980138: ["Fuchsia Fantastique", "FF"], 6550129: ["Scissors", ""],
}, bundle: {} });
const postedAt = "2026-11-18T15:00:00Z";
const day = 86400000;

test("submitted proof examples are oriented by the confirmed target side", () => {
  const bundle = parsePost({ postedAt, text: "Items: 2x Ice Valk + Legit v FF\nValues: 317k v 330k S: seller R: buyer D: 14/11/26" }, index);
  assert.equal(submittedOverpay(bundle, 0), 13000);
  assert.equal(bundle.baskets[0][0].quantity, 2);
  assert.equal(bundle.baskets[0][0].matches[0].id, "4390891467");
  assert.equal(shapeFor([[item("4390891467"), item("19027209")], [item("20980138")]], 0), null);
  const isolated = parsePost({ postedAt, text: "Items: Scissors + Legit vs FF\nValues: 0.155m vs 150k\nD: 11/14/26" }, index);
  assert.equal(submittedOverpay(isolated, 1), 5000);
  assert.equal(isolated.baskets[0][0].matches[0].id, "6550129");
  assert.equal(shapeFor([[item("6550129"), item("19027209")], [item("20980138")]], 1), "one-for-many");
  const priced = (id, value) => ({ ...item(id), price: { value } });
  const scissors = priced("6550129", 100000);
  assert.deepEqual(priceTarget([[scissors, priced("19027209", 55000)], [priced("20980138", 150000)]], 1),
    { overpay: 5000, majorItems: [scissors] });
});

test("date ambiguity and missing units stay visible", () => {
  const proof = parsePost({ postedAt, text: "Item(s): FF\nValues: 150 vs 155k D: 11/12/26" }, index);
  assert.deepEqual(proof.dates, ["2026-11-12", "2026-12-11"]);
  assert.equal(submittedOverpay(proof, 0), null);
  assert.deepEqual(proof.issues, ["ambiguous-or-unrecognized-date", "missing-or-unclear-units"]);
  assert.deepEqual(dateCandidates("31/02/26", postedAt), []);
});

test("unlabeled item and value lines precede compact sender, receiver and date fields", () => {
  const text = "Legit / FF\n6k vs 230k (reported gain)\nS: ExampleOne\nR: ExampleTwo\nD: 11/17/2026 (edited)\nTuesday, November 17, 2026 at 11:16 PM";
  const proof = parsePost({ postedAt, text }, index);
  assert.deepEqual(proof.submitted, [6000, 230000]);
  assert.deepEqual(proof.dates, ["2026-11-17"]);
  assert.equal(proof.baskets[1][0].matches[0].id, "20980138");
  assert.equal(proof.fields.sender, "ExampleOne");
  assert.equal(proof.raw, text);
});

test("historical pricing rejects missing or incomplete histories and same-day value changes", () => {
  const html = 'var value_changes = [[1767355200,1,1,1,100000,110000],[1767225600,1,1,1,null,100000]];';
  const source = "https://www.rolimons.com/item-value-changes/1";
  const history = parseHistory(html, item("1"), 110000, source);
  assert.equal(priceAt(history, "2026-01-02", 0), null);
  assert.equal(priceAt(history, "2026-01-03", 0).value, 110000);
  assert.deepEqual(priceAt(history, "2026-01-02T12:00:00Z"), { value: 110000, effectiveAt: "2026-01-02T12:00:00.000Z", source });
  assert.equal(priceAt(history, "2025-09-01"), null);
  assert.equal(parseHistory(html, item("1"), 120000, source), null);
  assert.equal(priceAt(null, "2026-01-04"), null);
});

test("reposts keep both links and conflicting IDs require review", () => {
  const base = { date: "2026-11-15", participants: ["a", "b"], robux: [0, 0], baskets: [[item("1")], [item("2")]], hashes: ["image"] };
  const reversed = { ...base, participants: ["b", "a"], baskets: base.baskets.toReversed() };
  const rows = deduplicate([{ ...base, link: "first" }, { ...reversed, link: "repost" }]);
  assert.deepEqual(rows[0].links, ["first", "repost"]);
  assert.equal(rows[0].conflict, false);
  assert.equal(deduplicate([{ ...base, tradeId: "8" }, { ...base, tradeId: "9" }])[0].conflict, true);
});

test("30-day statistics suppress thin groups and trends without coverage in both windows", () => {
  const now = Date.parse(postedAt);
  const samples = Array.from({ length: 10 }, (_, i) => ({ overpay: (i - 2) * 1000, time: now - day, links: ["a"] }));
  assert.equal(aggregate(samples.slice(1), now).median, undefined);
  assert.equal(aggregate(samples, now).trend, null);
  const result = aggregate([...samples, ...samples.map((sample) => ({ ...sample, overpay: 500, time: now - 32 * day }))], now);
  assert.equal(result.median, 2500);
  assert.equal(result.mean, 2500);
  assert.equal(result.trend, 2000);
  assert.deepEqual(result.middle50, [250, 4750]);
  assert.deepEqual(result.links, ["a"]);
});
