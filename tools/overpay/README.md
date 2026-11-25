# Roxol overpay tools

## Historical valuation of RoUtility trades

From the repository root, use Node.js 22 or later and Microsoft Edge on Windows. Export trades from **View trades** on a Roblox Marketplace page, then run the resolver. A raw RoUtility response with a `trades` array is also accepted.

```powershell
node tools/overpay/resolve-trades.mjs trades.json valued-trades.json
node tools/overpay/trade-valuations.test.mjs
```

The resolver fetches one public Rolimon's item profile per distinct uncached asset in headless Edge. Each page has both the assigned Value change log and the RAP chart. Successful profiles are cached for six hours under `%LOCALAPPDATA%\Roxol\trade-valuations`. Set `ROXOL_TRADE_VALUATION_CACHE` to change the directory. A rate limit pauses network fetching for the rest of the run. Rerun later to resume with cached profiles. If a refresh fails, the last successful profile can still price timestamps it covers, with its original observation time.

- The latest reported trade observation is the valuation timestamp. If only one observation is available, it supplies the timestamp. An assigned Value change between the first and last observations leaves the item unresolved because the exact completion time is unknown.
- The resolver uses the Rolimon's assignment in effect during the observation interval. When the change log establishes that there was no assignment, it uses the latest RAP chart point at or before the valuation timestamp on the same UTC date. This is a dated snapshot and can miss a change between chart points. A missing same-day point, observations spanning two UTC dates, incomplete assignment history, or an unavailable item can leave the historical valuation empty.
- The output preserves each copy row and an explicit quantity where supplied. Basket totals require a valuation and quantity for every row on that side. Signed item-only OP is side B minus side A from the perspective of side A receiving side B. The percentage divides that difference by side A's total, and is empty if that total is zero or unknown. Robux on both sides is unknown.
- Current item-only OP uses the latest cached profile Values and RAP with their profile observation timestamps. Each historical item valuation includes its source URL and its change or snapshot timestamp. Provider fields stay in the report for comparison. The historical calculation uses only observations from the applicable history.

### RoUtility field checks

Positive `value_then` entries behave as RoUtility's historical Value. They differ from both RoUtility's current item Value on older records and Rolimon's historical assigned Value for some items. `rap` behaves as a transfer-observation RAP snapshot. The same asset can have different RAP across observations and differ from today's public feed. RoUtility has no public field contract establishing the precise snapshot or zero encoding.

In the Black Iron Antlers sample all 63 empty `value_then` fields were JSON `null`. Each corresponding asset had Value zero in RoUtility's public item feed and was independently unvalued in Rolimon's history at the observation. The sample contained no literal `value_then: 0`. A zero or null supplies no positive provider Value, and the resolver verifies the Rolimon's assignment before using RAP. [RoUtility item feed](https://routility.io/api/public/items) · [RoUtility tracker](https://routility.io/tracker) · [Rolimon's Black Iron Antlers profile](https://www.rolimons.com/item/398674411)

### Black Iron Antlers verification

The original lookup reported 4,736 trades and 7 of the first 40 fully covered by `value_then`. The live retest found 4,737 trades. The 40 records immediately after the new leading record reproduced the 7-trade baseline and covered November 25, 2026 from 01:05 to 13:19 UTC. This reconstructs the earlier window from the live feed. The original record IDs were unavailable for comparison.

| Coverage | Copies | Trades with both baskets priced |
| --- | ---: | ---: |
| Positive RoUtility `value_then` | 109 / 172 | 7 / 40 |
| Historical resolution | 172 / 172 | 40 / 40 |

Rolimon's assigned Value priced 108 copies, and a same-date historical RAP point priced 64. Of the 109 positive RoUtility Values, 92 matched Rolimon's assignment at the item observation, 16 differed, and one (Vault Commando, reported at 8,000) had no Rolimon's assignment. The sample's 7 copies of 8-Bit Royal Crown account for 7 of the 16 differing Values (38,000 versus 40,000).

All 172 rows had RoUtility RAP. At each copy's observation time, the latest preceding Rolimon's RAP chart point on the same UTC day agreed on 146 of 172 rows. The largest difference was 304 Robux. Historical and current item-only OP differed in 22 of the 40 trades. A warm rerun reused all 98 profiles and made zero network requests. RoUtility's observation window can differ from the actual trade completion time, and sampled RAP can differ from the RAP at the exact observation.

Headless Edge checks used the live Black Iron Antlers page and RoUtility feed at 1,440 px and 375 px. The fixture run used the same widths and verified that the trade viewer displays a quantity of two and exports it alongside distinct zero and missing Value fields.

## Historical overpay statistics

```powershell
node tools/overpay/resolve-trades.mjs trades.json valued-trades.json
node tools/overpay/resolve-trades.mjs trades.json valued-trades.json --completed pilot.json
node tools/overpay/validate-trades.mjs trades.json pilot.json audit.json
node tools/overpay/item-overpay.test.mjs
```

Open `itemOverpay.items[assetId]` in the valuation report. Each group's `recent` window covers the last 30 days and `allObserved` covers observations supplied in the input. Exported pages determine how much of each window is represented.

- OP is historical item value received minus historical item value given. Percentage OP divides each trade's difference by the focal item's historical value before calculating the distribution. For a swap, the perspective gives the focal item. For an upgrade, it receives the focal item alone. For a downgrade, it gives the focal item alone. One-for-many trades contribute once to each perspective for the isolated item, so their signs mirror each other and their counts describe the same trades.
- Each window reports the median, the 25th and 75th percentiles using linear interpolation, and their difference (IQR) for both OP and percentage OP. Empty groups return null statistics. Groups with fewer than ten fully priced trades are labeled thin. Recency includes the first and last eligible observation, the latest priced observation, and its age in days.
- Valuation coverage is fully priced trades divided by eligible trades for that item and group, with counts for assigned Value alone and for baskets using RAP. Every copy needs a positive historical valuation. Invalid quantities, duplicate copy IDs, the same asset on both sides, many-for-many trades, bundled targets, and unusable observation times are tallied as exclusions. Distinct copies of the same asset can appear together on one side and each contributes its quantity to the total. The report includes all priced trades and shows how the median changes when removing trades where one basket is worth more than twice the other. Copy-specific premiums are outside the item valuation.
- The calculations use item values for all samples. Robux coverage counts priced samples with unknown, proof-reported zero, and proof-reported nonzero Robux. The resolver carries over amounts only from copy-corroborated proofs and records the fee basis when documented. These amounts stay out of the item-only OP calculations.

### Completed-trade audit

Use `pilot.json` from the local proof analyzer after reviewing completed trades and their attachments. The audit compares both baskets as unordered sets of copies with quantities, allowing either side order. A matching serial for the same asset, user asset ID, or instance ID provides copy corroboration. A conflicting comparable identifier rules out that candidate. A unique composition and date match without matching identifiers is reported as a basket match. Tied candidates and candidates shared by multiple proofs remain ambiguous.

The audit allows RoUtility observations up to 48 hours after the possible completion time, with five minutes of clock tolerance before completion. A date-only screenshot of unknown time zone uses the applicable range of UTC offsets. The output preserves RoUtility's `inferred` flag and compares outcomes by flag. These are proof-to-feed recovery counts for the pages sampled. A missing match can reflect coverage, and feed records without a proof have unknown completion status. The Roblox completed list returned HTTP 401 in a signed-out request. Roblox documents it as an authenticated account endpoint. [Roblox Trades API](https://create.roblox.com/docs/cloud/reference/features/trades)

On November 25, 2026, 635 distinct live RoUtility records across 11 asset histories were compared with 11 previously reviewed completed-trade proofs. Two serial transcriptions were corrected by rereading the screenshots. Six proofs had copy corroboration, one matched both baskets without copy corroboration, one matched two indistinguishable candidates, and three had no match in the sampled pages. Three copy-corroborated proofs showed nonzero Robux, including one explicitly labeled after the 30% fee. Every audited feed record had `inferred: false`, so the audit establishes no accuracy estimate for records explicitly marked `inferred: true`.

### Live statistics check

The November 25 run used 47 distinct live RoUtility records sampled from four asset histories and fetched Rolimon's histories with headless Edge. Both baskets resolved in 46 records. The table reports priced observations over eligible observations from the export. Upgrade and downgrade columns have the same counts because they describe the same one-for-many exchanges.

| Item | Rolimon's demand and rarity | Swaps | Upgrades | Downgrades |
| --- | --- | ---: | ---: | ---: |
| Perfectly Legitimate Business Hat | Amazing | 4 / 4 | 0 / 0 | 0 / 0 |
| Black Iron Antlers | High | 1 / 1 | 2 / 2 | 2 / 2 |
| The Agonizingly Ugly Bucket of Doom | Low | 2 / 2 | 3 / 4 | 3 / 4 |
| Crimsonwrath, Duke of Danger | Terrible, rare | 1 / 1 | 5 / 5 | 5 / 5 |

All groups were thin. Fixture tests checked the numeric distributions, missing and stale observations, zero and unknown Robux, multi-copy baskets, exclusions, and ambiguous proof matches.

## Discord proof collector

The collector is a research tool for the completed-trade audit. The extension's Overpay section uses live RoUtility trade history and Rolimon's historical valuations.

Use Node.js 22 or later and Microsoft Edge on Windows. Run these commands from the repository root.

```powershell
node tools/overpay/sign-in.mjs
node tools/overpay/collect.mjs <discord-username> 75
node tools/overpay/collect.mjs --use-current-account --backfill 200
```

Sign in to the Discord alt in the dedicated Edge window and close it before collecting. The collector verifies the account and Rolimon's **#value-requests** channel. A regular collection rereads the latest 12 saved posts for edits and includes new posts.

Backfill starts at the oldest saved post and reads up to 200 older posts. You can supply a limit from 1 to 200. Backfill keeps the checkpoint used by regular collection. The command reports the number of posts and images saved and the date range reached.

If paging or an attachment download fails, rerun the same command. The saved post list updates only after the whole batch is ready, and posts are keyed by Discord message ID. A successful backfill moves the oldest saved post, so another successful invocation collects an earlier batch.

The dedicated Edge profile and collected evidence are stored under `%LOCALAPPDATA%\Roxol\overpay` by default. Set `ROXOL_OVERPAY_DIR` to use another local directory.

### Review completed proofs

Run `node tools/overpay/analyze.mjs` to produce `pilot.json`. Add `--ocr` if Tesseract is on PATH and you want OCR text alongside unreviewed attachments. Inspect the saved images for completed status, both item baskets, Robux amounts, the trade date, and any visible copy or trade IDs. Add verified entries to `reviews.json` and rerun the analyzer to incorporate them into the report.

A review maps a Discord message ID to the screenshot findings. Use the attachment hash listed in `pilot.json`. Item IDs are strings, and each side uses `asset` or `bundle`, an ID, and a quantity. Add `copyId` and `tradeId` when visible. Side order is zero-based for `targetSide` and consistent across the other fields. Use an ISO timestamp with an offset when known. For date-only records, `offsetMinutes` is the offset from UTC if the evidence establishes it. A review example with placeholders:

```json
{
  "1450000000000000000": {
    "evidenceSha256": "<attachment hash from pilot.json>",
    "completed": true,
    "staffReview": "unknown",
    "date": "2026-11-15",
    "participants": ["Sender", "Receiver"],
    "baskets": [
      [{ "kind": "asset", "id": "19027209", "quantity": 1 }],
      [{ "kind": "asset", "id": "20980138", "quantity": 1 }]
    ],
    "robux": [0, 0],
    "targetSide": 0,
    "roPost": { "result": "<match, discrepancy, or unavailable>", "reference": "<RoPost lookup or result link>" }
  }
}
```

If a post contains multiple completed trades, use an array of review entries for that message ID and give each entry its matching attachment hash. Use `robuxBasis` to record whether the screenshot shows an offered amount or an amount after the fee. Use `serial` for a visible serial number and `copyId` for an actual copy ID.
