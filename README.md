# Roxol

Roxol is a Chrome and Edge extension for Roblox limited items and trading. It uses live data from Roblox, Rolimon's, and RoUtility.

## Current features

- **Item insights** on supported Marketplace cards, item and bundle detail pages, and inventory cards. See Recent Average Price (RAP), Rolimon's assigned value or a labeled fallback, demand, published trend, and rare or projected flags where available. **Might raise** and **Might drop** compare the current RAP snapshot with value-tier thresholds. Detail pages compare Roblox's Best Price with RAP and assigned value.
- **Sales history** with an interactive preview and a full viewer. See tracked sale dates, estimated prices, RAP before and after each sale, how often sales exceeded pre-sale RAP, and how the median prices for the last 10 and 30 tracked sales compare with assigned value and Best Price. The full viewer also includes Roblox's daily resale prices and volume where available.
- **Profiles and inventories** with RAP and value totals for loaded copies, a paginated breakdown, serial numbers where available, and RoliBadges. Eligible profiles can show a **Trade Items** shortcut in narrow layouts.
- **Trade comparisons** on selected trades and send and counter forms. Each offer shows its Rolimon's total below the native total, which is labeled `(RAP)`. The Rolimon's total uses the same item fallbacks and Robux amounts as the value comparison. Limited-item cards show Roblox RAP, Rolimon's value or a labeled RAP fallback, and demand, state, and sales history where available. Centered badges between the offers show signed RAP and value changes, with Robux and Rolimon's icons and green and red indicators for gains and losses.
- **Overpay** on limited Marketplace asset pages. Compare one-for-one and one-for-many exchanges with median OP, median OP percentage, priced sample size, UTC date range, and individual recent trades from RoUtility.
- **Item trade history** from RoUtility. Select **View trades** on a Roblox Marketplace asset page to see both sides of tracked exchanges, their observation times, and RoUtility's reported RAP and Value. A local report resolves historical Rolimon's valuations and gives per-item swap, upgrade, and downgrade overpay statistics for exported trades.
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

## Item overpay

On a limited Marketplace asset page, the **Overpay** section appears below Roxol's item metrics. It samples the first page of public RoUtility history (up to 20 tracked trades) and fetches Rolimon's profiles for historical pricing. Switch between **One-for-one** and **One-for-many** to see each group's statistics and up to five recent exchanges. The same sampled history page can be reused when you open **View trades**.

OP is the historical value of the other basket minus the value of the single copy of the page item you give. OP percentage divides each difference by that copy's historical value before taking the median. Roxol uses Rolimon's Value in effect during the observation interval or same-day RAP when the item was unvalued. Only fully priced trades contribute to medians. **Priced trades** shows that sample size out of the eligible trades, and **Observed dates (UTC)** covers the group's eligible records. Missing valuations show as a dash. Thin samples are labeled, side payments are unknown, and RoUtility's observation date can differ from the completion date. [Historical valuation and eligibility rules](tools/overpay/README.md#historical-overpay-statistics)

To verify the section, open Black Iron Antlers (asset `398674411`) in Edge with Roxol loaded. Wait for the Overpay figures, switch both trade types, and check the sample count and dates alongside the signed OP shown for each trade. Repeat at desktop and narrow widths. [Edge CDP verification workflow](AGENTS.md)

## RoUtility trade history

Roxol requests public history from `routility.io` when the Overpay section loads or you open or page through the viewer. Requests send the asset ID and page number without cookies. RoUtility reports when it observed the exchanges and cannot see side payments. Unavailable figures appear as a dash.

**Export viewed trades** downloads JSON for the pages visited since opening the viewer. It includes source page coverage and fetch times, deduplicated trade records, and both item baskets with quantities, available copy IDs, observation times, and RoUtility's RAP and `valueThen`. Missing fields are `null`. An explicit zero remains zero in the export. The export omits participant identifiers and side payments.

Run `node tools/overpay/resolve-trades.mjs trades.json valued-trades.json` with Node.js 22 or later and Edge on Windows. The report includes Rolimon's historical Value or dated RAP, per-item provenance, both basket totals, and signed item-only overpay. It also includes a separate calculation based on current snapshots. See the [historical valuation guide](tools/overpay/README.md#historical-valuation-of-routility-trades) for the cache, timing rules, and sample results.

In the report, `itemOverpay.items` is keyed by asset ID and includes median OP, median percentage OP, quartiles, interquartile range, sample size, observation dates, and valuation and Robux coverage. Statistics cover the last 30 days and all observations in the export. Add `--completed pilot.json` to audit against reviewed Roblox completed-trade evidence, or run `node tools/overpay/validate-trades.mjs trades.json pilot.json audit.json` for the audit alone. [Method and live verification](tools/overpay/README.md#historical-overpay-statistics)

To verify the integration, open Black Iron Antlers (asset `398674411`) in Edge with Roxol loaded. Select **View trades**, browse to the second page, and export the viewed trades. Check the two page entries and the two baskets per trade in the file. [Edge CDP verification workflow](AGENTS.md)

## Contributing

After each implementation, update the relevant README files and include those updates in the same commit. Summarize what changed in the commit subject and explain why in the commit body. Push to the corresponding GitHub branch and verify that its tip matches the local commit.
