# Market data acquisition plan

Start the LLM context export with individual item trades and historical valuations. Add pricing, liquidity, supply, and trading activity around those records. Track the source, observation time, and coverage for each metric so historical comparisons and overpay analysis can be reproduced. Proof lookup and screenshots can ship independently. [Existing overpay analytics plan](OVERPAY_ANALYTICS_PLAN.md)

## 1. Resale listing depth

Resolve the collectible item ID through `GET https://economy.roblox.com/v2/assets/{assetId}/details` and reuse the existing asset and collectible routing in the market worker. Fetch the cheapest ten listings from the applicable endpoint. Use `cursor` for additional collectible pages when needed for the requested depth. [Market worker](extension/background/market.js)

```text
GET https://economy.roblox.com/v1/assets/{assetId}/resellers?limit=10
GET https://apis.roblox.com/marketplace-sales/v1/item/{collectibleItemId}/resellers?limit=10
```

Export the first five and ten prices, median price for the fetched listings, count of fetched listings strictly below assigned Value, and the gap between the two cheapest listings. Include the observed listing count, depth limit, and whether more listings are available. Leave the gap empty with fewer than two listings and the below-Value count empty when assigned Value is unavailable. Items with the same Best Price can have different counts below Value.

## 2. Historical Value, RAP, and resale activity

- **Assigned Value.** Parse the timestamp, previous Value, and new Value from Rolimon’s HTML change history. Export the previous assigned Value, days since the last change, and the 30- and 90-day Value deltas from the Values in effect at those cutoff dates. Preserve the source’s timestamp precision and flag incomplete history. Use the Black Iron Antlers 13,000 to 12,000 change reported for November 23, 2026 as a verification case. The current Stable label is a separate field. [Black Iron Antlers Value history](https://www.rolimons.com/item-value-changes/398674411)
- **RAP history.** Reuse Rolimon’s tracked sales already shown in Roxol. Export available pre-sale and post-sale RAP with the corresponding timestamps and source coverage. [Market worker](extension/background/market.js)
- **Daily resale price and volume.** Reuse the existing legacy and collectible requests below. Export the source series with its dates and record gaps where data is unavailable. [Market worker](extension/background/market.js)

```text
GET https://economy.roblox.com/v1/assets/{assetId}/resale-data
GET https://apis.roblox.com/marketplace-sales/v1/item/{collectibleItemId}/resale-data
```

## 3. Supply and valuation methodology

Read Rolimon’s item page at `https://www.rolimons.com/item/{assetId}`. Export total copies, available copies, premium copies, hoarded percentage, average daily sales, sellers, and valuation method. Preserve the provider’s labels, including `Proof-Based`. Timestamp each snapshot and leave absent fields empty. The research identified these fields on the Black Iron Antlers page. A dedicated JSON endpoint remains unverified. [Black Iron Antlers item page](https://www.rolimons.com/item/398674411)

## 4. Trade advertisement activity

Verify the live response and sampling window for `GET https://api.rolimons.com/tradeads/v1/getrecentads`. The reported `trade_ads` entries contain `[adId, unixTimestamp, userId, username, offer, request]`. Confirm the representation of explicit item requests and generic request tags before deriving metrics.

Deduplicate by ad ID and export per-item offer count, explicit request count, request-to-offer ratio, unique advertiser count, and the requested-versus-offered Value difference for ads with fully priceable baskets. Include the observation window and sample size. Leave the ratio empty when there are zero offers. Confirm access for recurring historical collection before scheduling it. [Rolimon’s trade ads](https://www.rolimons.com/tradeads)

## 5. Individual trade records and validation

| Dataset | Acquisition and interpretation |
| --- | --- |
| Authenticated completed trades | Use Roblox’s Trades API for consenting users’ own completed trades. A clean Edge profile received HTTP 401 from the listing endpoint. Page through the list and fetch trade details in a signed-in session to establish the reference sample. [Roblox Trades API](https://create.roblox.com/docs/cloud/reference/domains/trades) |
| Inferred exchanges from RoUtility | Visible Edge fetched two pages of 20 distinct Black Iron Antlers records while signed out. RoUtility reported 4,736 records in that snapshot. The global tracker also made a successful `/web/moves/recent` JSON request. Verify requests from Roxol’s background worker before relying on the website endpoint. [Black Iron Antlers trade history](https://routility.io/catalog/398674411/trades) |
| Inferred exchanges from Void | Nevos identifies Void `itemtrades` as the upstream source for its asset history. No public API documentation was located. Verify whether `/itemtrades` offers exportable records or a formatted Discord reply. [Void](https://discord.com/servers/void-market-analysis-tools-1463051876860825734) |
| Inferred exchanges from RoPost | Its documented method groups ownership transfers between the same players at matching timestamps and checks inventories for incomplete transfers. Its item lookup produces trade cards. A machine-readable export remains unverified. [RoPost repository](https://github.com/sephh23/RoPost) |

```text
GET https://routility.io/web/item-trades/{assetId}?range=all&limit=20&page=1
GET https://trades.roblox.com/v1/trades/Completed
GET https://trades.roblox.com/v2/trades/{tradeId}
```

The observed RoUtility response includes `trades`, `page`, `pages`, and totals. Trade records include `trade_id`, `ts`, `ts_latest`, `kind`, `inferred`, and `side_a_items` and `side_b_items`. The sampled basket items contain `asset_id`, copy identifiers, `rap`, and `value_then`. Only seven of the first 40 records had a positive `value_then` for every item, so historical valuation coverage needs its own check and fallback. Confirm timestamp units and the meaning of `value_then`. Keep the provider’s observation time distinct from any verified completion time. RoUtility’s tracker cannot observe accompanying Robux or USD. [RoUtility tracker](https://routility.io/tracker)

Use an opt-in, signed-in Roblox sample as the reference dataset. Match RoUtility records against completed Roblox trades by both baskets, copy IDs when available, and a documented time window. Report how many trades matched, basket and timestamp discrepancies, and how much recorded Robux changes the estimated OP. Preserve unknown payments as missing. Keep participant identifiers local to matching and leave them out of the LLM export.

## Proof lookup

Evaluate this as a separate feature after trade records can flow into the export. RoPost documents item-specific `/proof` lookups and screenshot processing. Public documentation does not establish export functionality. Nevos has proof-search and image routes, but an unauthenticated proof-search test returned a placeholder. Preserve post IDs, original text, timestamps, and evidence links when a source provides them. [RoPost proof lookup](https://github.com/sephh23/RoPost#value-proofs) · [Existing collector guide](tools/overpay/README.md)

## Export and verification

- Include the asset ID, collectible item ID where relevant, source, collection timestamp, effective date or sample window, and available coverage. Preserve missing data separately from observed zeroes. Cache successful fetches, retain the last observation timestamp on transient failures, and make repeated imports idempotent.
- Export individual trades alongside any summary. Start with complete two-sided exchanges, deduplicate by source trade ID, and price both baskets using historical Value or historical RAP where supported. For isolated target items, group one-for-one and one-for-many trades by direction and report median item-only OP, middle 50%, sample size, and date window. Record historical and current-equivalent OP separately and include reported OP when a proof provides it. Keep unpriceable records visible and report their count.
- Validate legacy and migrated assets, listings with additional pages, empty listing sets, same-day Value changes, incomplete history, and ads with generic requests. Spot-check live data against the source and record which cases used fixtures. If the export adds an extension UI, verify its desktop and narrow layouts using the repository’s Edge CDP workflow. [Repository verification guide](AGENTS.md)
- Confirm collection and reuse arrangements for Rolimon’s HTML pages and recurring trade-ad history. Review how those arrangements apply to existing Roxol integrations as part of implementation. Keep these sources in the acquisition plan while access is confirmed. [Rolimon’s published terms](https://www.rolimons.com/termsandprivacy)

## Implementation order

1. Verify RoUtility background-worker access and coverage across items, then normalize its trade records for the LLM export.
2. Collect the opt-in Roblox reference sample and validate basket matching, timestamps, and item-only OP against it.
3. Join historical Value and RAP to the trade records and publish coverage and item-only OP summaries.
4. Add resale listing depth, supply and valuation methodology, and verified trade advertisement metrics.
5. Evaluate Void and RoPost as alternate feeds and pursue item proof lookup independently.
