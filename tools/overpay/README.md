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

## Discord proof collector

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
