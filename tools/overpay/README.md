# Roxol overpay tools

## Compare Discord and Nevos proof coverage

From the repository root, use Node.js 22 or later and the existing MCP dependencies (`npm ci --prefix tools/mcp`). Set `ROXOL_DISCORD_TOKEN` in the environment or in the Git-ignored `tools/mcp/.env` file to reuse the authorized Discord credential across runs. Then run the comparison.

```powershell
node tools/overpay/compare-bia-proofs.mjs
```

For a one-time run without a saved credential, use the hidden PowerShell prompt and pass the credential on standard input.

```powershell
([System.Net.NetworkCredential]::new('', (Read-Host 'Discord credential' -AsSecureString))).Password | node tools/overpay/compare-bia-proofs.mjs
```

The comparison reads up to four 25-result pages each for `BIA` and `Black Iron Antlers` in Rolimon’s `value-requests` channel, ordered newest first. It checks the first image of up to eight recent posts per source and uses the Marketplace caption parser and current Rolimon’s prices for both Median OP samples. Discord's search counts include raw matches. Compare the post IDs, dates, shared captions, and qualifying proof counts within the sampled window. The report omits credential values, caption contents, and signed image URLs. A rejected Discord request stops pagination and retains results collected so far.

Nevos uses the existing MCP credential settings from the environment or `tools/mcp/.env`. Run `node tools/overpay/compare-bia-proofs.mjs --nevos-only` to check that side independently. The comparison leaves the running MCP and Marketplace proof providers in place. Run `node tools/overpay/compare-bia-proofs.test.mjs` for the fixture checks.

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
node tools/overpay/overpay-sampling.test.mjs
```

Open `itemOverpay.items[assetId]` in the valuation report. Each group's `recent` window covers the last 30 days and `allObserved` covers observations supplied in the input. Exported pages determine how much of each window is represented.

The standalone resolver analyzes RoUtility observations. The extension’s Marketplace panel uses Nevos downgrade captions across all returned dates. Caption item totals supply basket values. Roxol uses current Rolimon’s Value, or RAP for unvalued items, to compare individual items when caption totals alone cannot establish direction. Outgoing item adds must total less than half the target’s price. Cash trades require a caption with explicit item totals and separate offered Robux amounts. Sideways swaps, upgrades, unresolved captions, and screenshot-only posts fall outside the estimate. Incoming Robux are rounded to the nearest Robux after the 30% fee. The headline and audit `median` use only strictly positive net OP from the target owner’s side, and `qualifyingProofCount` counts those proofs. **Qualifying proofs** lists the evidence used in the median. The **Download proof audit** export includes both baskets, Robux and item totals, signed OP, and links for all priced downgrades. Run `node --test tools/overpay/proof-overpay.test.mjs tools/overpay/overpay-sampling.test.mjs` to check classification, pricing, and provider integration. [Marketplace setup](../../README.md#marketplace)

The standalone valuation report works from the supplied export and uses the end of each observation interval for its recent window. Its `normalizationExclusions` and `excludedRecords` preserve duplicate and malformed inputs that could not be normalized into `trades`. The `profileFailures` map carries reason codes and observed HTTP statuses by asset ID. Individual resolved records include the severe-imbalance flag and historical valuation gaps by item row.

- OP is historical item value received minus historical item value given. Percentage OP divides each trade's difference by the focal item's historical value before calculating the distribution. For a swap, the perspective gives the focal item. For an upgrade, it receives the focal item alone. For a downgrade, it gives the focal item alone. One-for-many trades contribute once to each perspective for the isolated item, so their signs mirror each other and their counts describe the same trades.
- Each window reports the median, the 25th and 75th percentiles using linear interpolation, and their difference (IQR) for both OP and percentage OP. The raw distributions include every fully priced eligible trade. The `marketRate` distributions exclude trades where one basket is worth more than twice the other. Empty groups return null statistics. Recency includes the first and last eligible observation, the latest priced observation, and its age in days.
- Valuation coverage is fully priced trades divided by eligible trades for that item and group, with counts for assigned Value alone and for baskets using RAP. Every copy needs a positive historical valuation. Invalid quantities, duplicate copy IDs, the same asset on both sides, many-for-many trades, bundled targets, and unusable observation times are tallied as exclusions. Distinct copies of the same asset can appear together on one side and each contributes its quantity to the total. Copy-specific premiums are outside the item valuation.
- Standard market-rate confidence requires at least 30 retained trades, at least 80% pricing coverage, and no more than 10% of priced trades severely imbalanced. Fewer than 10 retained trades yields an insufficient-sample label. Other samples have low confidence. Unpriced-reason counts can overlap within a trade.
- The calculations use item values for all samples. Robux coverage counts priced samples with unknown, proof-reported zero, and proof-reported nonzero Robux. The resolver carries over amounts only from copy-corroborated proofs and records the fee basis when documented. These amounts stay out of the item-only OP calculations.

### Marketplace audit verification

On November 26, 2026 the saved Silver King of the Night audit was replayed at its original cutoff using one live Rolimon’s item-details response. The replay kept all 150 records and the same 70 eligible trades. One-for-many priced 28 of 35, retained 22 after the imbalance filter, and had a filtered median OP of −4,607.5 (previously −5,250). One-for-one priced 34 of 35 and retained nine, which is below the headline minimum. Each eligible trade’s OP, percentage, and imbalance flag were checked against an independent basket calculation. Fixture tests also cover seven-day eligibility, quantities, missing prices, partial history, shared bulk requests, and repricing saved trades after a worker restart.

Headless Edge also checked the live Marketplace panel and **View trades** at 1,440 px and 375 px. The live one-for-many estimate matched the replay, and the viewer showed current prices alongside the original RoUtility values under **Valuation details**.

The Get and Give display was checked on the live Silver King of the Night listing for negative and insufficient results. A dark-theme fixture verified positive and even results, plus access to pricing coverage and trade counts in **Estimate details**. Both checks used 1,440 px and 375 px Edge viewports.

### Historical Marketplace cold-cache verification

These measurements used the former Marketplace calculator with Rolimon’s historical profiles.

On November 25, 2026, two live item pages in a fresh headless Edge profile reached 33/133 swaps and 1/117 downgrades for Silver King of the Night (SKOTN), and 31/133 swaps and 2/92 downgrades for The Classic ROBLOX Fedora (CF). The previous scheduler started 24 profile requests in a burst. Sixteen succeeded and eight returned HTTP 429 with `Retry-After` values of 2,791 to 2,792 seconds. The panel retried its history once at the local budget boundary, but sent no new profile requests and showed no coverage gains during the six-minute observation. Neither group for either item reached 80% or 95%. The 429 cooldown prevented further live measurement. The previous sampler also spent the request budget in page order, and transient non-429 failures did not schedule a retry by themselves.

A separate cold-cache Edge run opened both live Roblox pages concurrently and used the full live RoUtility samples with fixture Rolimon's profile responses. These times measure when the UI first displayed each threshold, from navigation. The fixture supplied complete dated history, one 429 with an eight-second `Retry-After`, and one temporary 503. The separate recovery smoke run measured 8.124 seconds before requests resumed and 22.591 seconds before the 503 retried successfully. The fixture timings measure scheduling and UI updates with known inputs. Live historical coverage can fall below the fixture's coverage.

| Item and trade group | Eligible trades | Time to 80% | Time to 95% |
| --- | ---: | ---: | ---: |
| SKOTN one-for-one | 133 | 4:34 | 8:04 |
| SKOTN one-for-many | 117 | 6:34 | 10:06 |
| CF one-for-one | 133 | 6:08 | 7:29 |
| CF one-for-many | 92 | 8:30 | 10:19 |

Each previously unseen counterpart still requires a profile. One-for-many trades can require several profiles, and shared provider limits or missing historical Value and dated RAP can delay or prevent full coverage. The 24-per-minute cap is Roxol's local maximum. Rolimon's can impose a stricter limit, as the live run showed. [Architectures for a 10-second estimate](../../OVERPAY_ANALYTICS_PLAN.md#5-serve-marketplace-estimates-within-10-seconds)

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

### Marketplace coverage diagnosis

Two November 25, 2026 retests at commit `1cf770e` reproduced Fall Fairy's 157 eligible trades. They priced 36 and 32 trades, compared with the originally reported 38. The diagnostic run required 138 distinct profiles. All 25 HTTP 200 responses parsed with assigned Value history. Six requests returned HTTP 429 with `Retry-After: 60`, and 107 profile lookups were deferred. Four unpriced trades depended only on profiles that returned 429, 118 depended only on deferred profiles, and three depended on both. The subsequent Black Iron Antlers analysis sampled 176 eligible trades during the cooldown. It made zero profile requests and priced zero trades because the focal lookup was deferred and counterpart lookups were skipped.

The updated live run sampled 500 RoUtility records per item. Fall Fairy excluded 343 records from eligibility (197 bundled targets, 112 many-for-many, 22 invalid baskets, and 12 with the same asset on both sides). Black Iron Antlers excluded 323 (193 bundled targets, 117 many-for-many, 11 invalid baskets, and two with the same asset on both sides). The updated Black Iron Antlers sample had 177 eligible records as the live feed advanced.

| Item | Exchange | Priced / eligible | Raw median OP | Filtered median OP | Severe imbalances | Market-rate confidence |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Fall Fairy | One-for-one | 91 / 91 | −7,794 (−97.43%) | 0 (0%) | 77 | Low |
| Fall Fairy | One-for-many | 66 / 66 | +480.5 (+6.01%) | +500 (+6.25%) | 7 | Low |
| Black Iron Antlers | One-for-one | 83 / 86 | −11,802 (−98.28%) | 0 (0%) | 69 | Low |
| Black Iron Antlers | One-for-many | 91 / 91 | +1,273 (+10.61%) | +1,273 (+10.61%) | 2 | Standard |

The two analyses together received 219 profile responses with HTTP 200, 14 with HTTP 429 and a 60-second retry time, and five timeouts with no HTTP response. Coverage improved over repeated refreshes and an Edge restart. The reopened session made no repeat requests for profiles that previously returned HTTP 200. The three remaining Black Iron Antlers swaps had complete profiles, but their observation intervals crossed UTC dates and an unvalued counterpart required same-day RAP.

The live listings were checked with headless Edge at 1,440 px and 375 px. A separate fixture checked automatic recovery from HTTP 429, an HTTP 404 and an unrecognized HTTP 200 profile, an audit download retaining duplicate and malformed records, and a second item analysis that reused three shared profiles after an Edge restart. The restart used Developer mode in the disposable test profile to keep the unpacked extension enabled.

## Discord proof collector

The collector is a research tool for the completed-trade audit. The extension's Overpay section uses live RoUtility trade history and current Rolimon's values.

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

To serve approved public evidence through Roxol's MCP, copy the shareable entries from `pilot.json` into a separate JSON export with a `pricedTrades` array. The MCP reads that file at startup and returns an allowlisted projection of each record. [Proof export configuration](../mcp/README.md#reviewed-public-proofs)
