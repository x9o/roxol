# Roxol

Roxol is a Chrome and Edge extension for Roblox limited items and trading. It uses live data from Roblox, Rolimon's, and RoUtility.

## Current features

- **Item insights** on supported Marketplace cards, item and bundle detail pages, and inventory cards. See Recent Average Price (RAP), Rolimon's assigned value or a labeled fallback, demand or average daily sales, published trend, and rare or projected flags where available. **Might raise** and **Might drop** compare the current RAP snapshot with value-tier thresholds. Detail pages compare Roblox's Best Price with RAP and assigned value.
- **Sales history** with an interactive preview and a full viewer. See tracked sale dates, estimated prices, RAP before and after each sale, how often sales exceeded pre-sale RAP, and how the median prices for the last 10 and 30 tracked sales compare with assigned value and Best Price. The full viewer also includes Roblox's daily resale prices and volume where available.
- **Profiles and inventories** with RAP and value totals for loaded copies, a paginated breakdown, serial numbers where available, and RoliBadges. Eligible profiles can show a **Trade Items** shortcut in narrow layouts.
- **Trade comparisons** on selected trades and send and counter forms. Each offer shows its Rolimon's total below the native total, which is labeled `(RAP)`. The Rolimon's total uses the same item fallbacks and Robux amounts as the value comparison. Limited-item cards show Roblox RAP, Rolimon's value or a labeled RAP fallback, demand or average daily sales, state, and sales history where available. Centered badges between the offers show signed RAP and value changes, with Robux and Rolimon's icons and green and red indicators for gains and losses.
- **Overpay** on limited Marketplace asset pages. Compare raw trade statistics and filtered market-rate estimates for one-for-one and one-for-many RoUtility exchanges, with pricing coverage, confidence, and a downloadable sample audit.
- **Item trade history** from RoUtility. Select **View trades** on a Roblox Marketplace asset page to compare item baskets, reported totals, and overpay side by side. Expand a record for its observation details, RAP, and Value. A local report resolves historical Rolimon's valuations and gives per-item swap, upgrade, and downgrade overpay statistics for exported trades.
- **Reference links** to Rolimon's item, bundle, sales, and player pages.
- **Toolbar popup and settings** with Roblox sign-in status, Trades tab detection, an **Open Trades** shortcut, and a saved system, light, or dark appearance preference.

## Planned features

- **Expanded trade analysis** with trade-list win/loss previews, partner inventory value when available, and gross and net Robux after Roblox fees.
- **Trade navigation and search** with a **Send** shortcut beside **Counter**, links to Rolimon's item and player pages, and copy-specific ownership history when available. Search both inventories by item name or acronym, filter by demand, hold status, or serial where supported, and select the exact copy.
- **Pending-trade inventory checks** for both sides, with per-copy ownership and tradability status, a timestamp, and a **Check again** action.
- **Desktop trade alerts and settings** with separate opt-ins for inbound, declined, and completed trades, click-through to the relevant trade, a test notification, feature toggles, and an option to hide RAP deltas.
- **Per-item USD estimates** from RoUtility where available, with a separate optional estimate using a user-entered rate and live Rolimon's value.
- **Mass Trade Sender** with offer selection, manual recipient entry, a review queue, progress tracking, and native trade forms for manual sending. Owner discovery is planned once the data is verified.

- **Expanded overpay analytics** with broader trade coverage and sales-based lookback windows. The historical proof research is documented in the [overpay analytics plan](OVERPAY_ANALYTICS_PLAN.md).
- **Expanded market data exports** with reseller depth, resale activity, supply, and trade advertisements. Proof lookup can ship independently. See the [market data acquisition plan](MARKET_DATA_PLAN.md).

**Ideas under consideration** include a **Might drop** forecast that tracks sustained pressure below a value threshold, plus buy, sell, and trade calculators that account for volume, liquidity, outliers, and sparse or stale data.

## Load locally

Enable Developer mode at `chrome://extensions` or `edge://extensions`, then select **Load unpacked** and choose the `extension` folder.

The limited-card **Copy ID** control is disabled while its implementation is kept for future work.

Roxol reuses item and resale helpers from Nevos. [Nevos source license](extension/vendor/nevos/LICENSE)

## Resale activity badges

When Rolimon's has no assigned demand rating, Roxol uses the **Avg Daily Sales** figure from its public item or bundle page. Hover over or focus the badge for an explanation of the resale activity metric. The extension's background worker shares lookups across tabs, caches page results for five minutes, and caches transient failures for 20 seconds. A published zero displays as `0.00 sales/day`. If the figure is unavailable, the badge is hidden.

To verify the fallback, open Epic Egg (`4773569689`) in Marketplace and compare its badge with Rolimon's published figure. Check the same badge on an inventory or trade card that contains an unrated limited item. A rated item should still show its demand indicator. [Epic Egg on Rolimon’s](https://www.rolimons.com/item/4773569689)

## Item overpay

On a limited Marketplace asset page, the **Overpay** section appears below Roxol's item metrics. Roxol samples the past 30 days of first observations, up to 500 records across 10 RoUtility requests. It stops at the date boundary, the end of available history, or the record cap. This keeps the sample size independent of how many trades have already been priced. Switch between **One-for-one** and **One-for-many** to compare the filtered median OP, median OP percentage, retained trades, and confidence. Expand **Sampled trades** for the five most recent eligible exchanges, then **Show full sampled history** for the remaining records, including unpriced and severely imbalanced trades.

OP is the historical value of the other basket minus the value of the isolated copy of the page item. OP percentage divides each trade's difference by that copy's historical value. Roxol uses Rolimon's assigned Value in effect during the observation interval or same-day RAP when the item was unvalued. **Estimate details** shows raw and filtered statistics, interquartile ranges, and exclusion counts. Raw statistics include every fully priced eligible exchange. The market-rate estimate excludes trades where one basket was worth more than twice the other. Standard confidence requires at least 30 retained trades, at least 80% of eligible trades priced, and at most 10% of priced trades severely imbalanced. Fewer than 10 retained trades gives an insufficient-sample label. Other groups have low confidence. Robux side payments are unknown, and RoUtility's first observation can differ from the completion date. [Historical valuation and eligibility rules](tools/overpay/README.md#historical-overpay-statistics)

The progress bar follows the selected trade type and shows its priced, pending, and unavailable counts. **Preliminary estimate** appears while that group has pending valuations or RoUtility supplied partial history. **Insufficient data** appears when completed pricing leaves fewer than 10 retained trades. In both states, sample medians are available in **Estimate details** and the headline figures are withheld. Roxol stores recent samples for up to 12 items and shares historical Rolimon's profiles across items and browser sessions through IndexedDB. It reuses profiles through their fetch timestamp and prioritizes lookups likely to finish the most trades across the sampled pages. One shared queue spaces new profile requests at least 2.5 seconds apart, caps them at 24 per rolling minute, and pauses according to Rolimon's HTTP 429 retry time. An open panel resumes deferred work automatically and retries transient profile failures with backoff. [Cold-cache verification and remaining limits](tools/overpay/README.md#marketplace-cold-cache-verification)

**Download sample audit**, inside **Estimate details**, exports the sampled records, per-reason eligibility exclusions, imbalances, valuation failures with HTTP statuses when available, and summary statistics. One unpriced record can have multiple failure reasons.

To verify the section, open Fall Fairy (`128217885`) and Black Iron Antlers (`398674411`) with Roxol loaded. Check both trade types, pricing coverage, raw versus filtered medians, sampled history, and the audit export. Use worker fixtures for predictable loading, preliminary, completed, insufficient, and unavailable states. Check light and dark themes at desktop and narrow widths. [Edge CDP verification workflow](AGENTS.md)

## RoUtility trade history

Roxol requests public history from `routility.io` when the Overpay section loads or you open or page through the viewer. Requests send the asset ID and page number without cookies. The viewer requests item thumbnails from Roblox in batches. Each basket sums quantities at RoUtility's reported Value per copy, falling back to reported RAP when Value is missing or zero. The viewer shows OP as Side B minus Side A and divides by Side A for OP percentage. If either total is unavailable, the viewer labels the trade **Unpriced trade**. A basket worth more than twice the other is labelled **Severe imbalance**. Expand **Valuation details** to inspect the original RAP and Value, quantities, serials, and item observation times where available. RoUtility cannot see side payments.

**Export viewed trades** downloads JSON for the pages visited since opening the viewer. It includes source page coverage and fetch times, deduplicated trade records, and both item baskets with quantities, available copy IDs, observation times, and RoUtility's RAP and `valueThen`. Missing fields are `null`. An explicit zero remains zero in the export. The export omits participant identifiers and side payments.

Run `node tools/overpay/resolve-trades.mjs trades.json valued-trades.json` with Node.js 22 or later and Edge on Windows. The report includes Rolimon's historical Value or dated RAP, per-item provenance, both basket totals, and signed item-only overpay. It also includes a separate calculation based on current snapshots. See the [historical valuation guide](tools/overpay/README.md#historical-valuation-of-routility-trades) for the cache, timing rules, and sample results.

In the report, `itemOverpay.items` is keyed by asset ID and includes median OP, median percentage OP, quartiles, interquartile range, sample size, observation dates, and valuation and Robux coverage. Statistics cover the last 30 days and all observations in the export. Add `--completed pilot.json` to audit against reviewed Roblox completed-trade evidence, or run `node tools/overpay/validate-trades.mjs trades.json pilot.json audit.json` for the audit alone. [Method and live verification](tools/overpay/README.md#historical-overpay-statistics)

To verify the integration, open Black Iron Antlers (asset `398674411`) in Edge with Roxol loaded. Select **View trades**, browse to the second page, and export the viewed trades. Check the two page entries and the two baskets per trade in the file. [Edge CDP verification workflow](AGENTS.md)

## Contributing

Build trading surfaces, including future proof checkers, inside `.roxol-market` to inherit Roblox's typography and Roxol's neutral theme tokens. Reuse `.roxol-stat-grid` and `.roxol-number` for comparable figures, `.roxol-table` for audit tables, `.roxol-basket-pair` and `.roxol-trade-basket` for opposing baskets, and `.roxol-segments`, `.roxol-disclosure`, `.roxol-progress-bar`, and `.roxol-loading-status` for controls and loading. Apply sign colors to numerical indicators through `data-direction`. [Shared marketplace stylesheet](extension/content/market.css)

After each implementation, update the relevant README files and include those updates in the same commit. Summarize what changed in the commit subject and explain why in the commit body. Push to the corresponding GitHub branch and verify that its tip matches the local commit.
