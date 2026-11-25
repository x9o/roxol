# Market data acquisition plan

Add an asset-level export for limited-item pricing, liquidity, supply, and trading activity. Reuse Roxol’s resale history and local proof pipeline. Track the source, observation time, and coverage for each metric so historical comparisons and overpay analysis can be reproduced. [Existing overpay analytics plan](OVERPAY_ANALYTICS_PLAN.md)

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

## 5. Completed trades and overpay evidence

| Dataset | Acquisition and interpretation |
| --- | --- |
| Authenticated completed trades | Use Roblox’s Trades API for consenting users’ own completed trades. Page through the list and fetch trade details as needed. Keep authentication in the user session and identify these exports as personal trade history. [Roblox Trades API](https://create.roblox.com/docs/cloud/reference/domains/trades) |
| Submitted overpay proofs | Reuse the local Discord collector and reviewer. Preserve evidence references, completion checks, submitted totals, and the existing eligibility rules. Use complete historical Values for a separate recalculation. [Local collector guide](tools/overpay/README.md) |
| Inferred exchanges from RoUtility | Evaluate read-only data access with RoUtility’s developers. The public tracker shows item baskets, Value, and RAP. The research notes reported 2,415 trades in one indexed 24-hour snapshot. Bulk access remains unresolved, and accompanying Robux or USD payments are unobservable. [RoUtility tracker](https://routility.io/tracker) |
| Inferred exchanges from RoPost | Evaluate read-only data access with RoPost’s developers. Its documented method groups ownership transfers between the same players at matching timestamps and checks inventories for incomplete transfers. Confirm available fields, coverage, and access before building an importer. [RoPost repository](https://github.com/sephh23/RoPost) |

```text
GET https://trades.roblox.com/v1/trades/Completed
GET https://trades.roblox.com/v2/trades/{tradeId}
```

Record source IDs, timestamps, both item baskets, and any observed Robux with their basis. Preserve unknown payments as missing. Keep authenticated trades, submitted proofs, and inferred exchanges in separate datasets and publish separate overpay samples with their own coverage. Label figures derived from inferred exchanges as item-only estimates. Seek a partner feed before investing in a market-wide ownership tracker.

## Export and verification

- Include the asset ID, collectible item ID where relevant, source, collection timestamp, effective date or sample window, and available coverage. Preserve missing data separately from observed zeroes. Cache successful fetches, retain the last observation timestamp on transient failures, and make repeated imports idempotent.
- Validate legacy and migrated assets, listings with additional pages, empty listing sets, same-day Value changes, incomplete history, and ads with generic requests. Spot-check live data against the source and record which cases used fixtures. If the export adds an extension UI, verify its desktop and narrow layouts using the repository’s Edge CDP workflow. [Repository verification guide](AGENTS.md)
- Confirm collection and reuse arrangements for Rolimon’s HTML pages and recurring trade-ad history. Review how those arrangements apply to existing Roxol integrations as part of implementation. Keep these sources in the acquisition plan while access is confirmed. [Rolimon’s published terms](https://www.rolimons.com/termsandprivacy)

## Implementation order

1. Ship Roblox reseller depth using the existing market worker.
2. Add historical assigned Value through an authorized source and join it with existing RAP and resale series.
3. Add supply statistics and valuation methodology.
4. Verify recent trade ads and add demand metrics.
5. Evaluate RoUtility and RoPost feeds for inferred market-wide coverage. Scope authenticated personal trade import independently of partner availability.

Market-wide completed trade coverage is the main unresolved data dependency. The personal Roblox API covers the consenting account, and the two candidate market-wide sources provide inferred exchanges. Live trade-ad responses and source access for recurring collection also need confirmation.
