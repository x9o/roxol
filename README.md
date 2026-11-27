# Roxol

Roxol is a Chrome and Edge extension for Roblox limited items and trading. It uses live data from Roblox, Rolimon's, and RoUtility.

Developed by:
Discord @xo1o
Roblox @r8rar
Github @x9o

## Current features

- **Item insights** on supported Marketplace cards, item and bundle detail pages, and inventory cards. See Recent Average Price (RAP), Rolimon's assigned value or a labeled fallback, demand or average daily sales, published trend, and rare or projected flags where available. **Might raise** and **Might drop** compare the current RAP snapshot with value-tier thresholds. Detail pages compare Roblox's Best Price with RAP and assigned value.
- **Sales history** with an interactive preview and a full viewer. See tracked sale dates, estimated prices, RAP before and after each sale, how often sales exceeded pre-sale RAP, and how the median prices for the last 10 and 30 tracked sales compare with assigned value and Best Price. The full viewer also includes Roblox's daily resale prices and volume where available.
- **Profiles and inventories** with RAP and value totals for loaded copies, a paginated breakdown, serial numbers where available, and RoliBadges. Eligible profiles can show a **Trade Items** shortcut in narrow layouts.
- **Trade comparisons** on selected trades and send and counter forms. Each offer shows its Rolimon's total and average item demand below the native total, which is labeled `(RAP)`. The Rolimon's total uses the same item fallbacks and Robux amounts as the value comparison. Limited-item cards show Roblox RAP, Rolimon's value or a labeled RAP fallback, demand or average daily sales, state, and sales history where available. Centered badges between the offers show signed RAP and value changes, with Robux and Rolimon's icons and green and red indicators for gains and losses.
- **Trade list previews** on Inbound, Outbound, Completed, and Closed or Inactive. Each row shows what you give above what you receive, with a Robux icon for RAP and a Rolimon's icon for value. Wide green and red stripes mark gains and losses for each metric. Hover over either pair for its label and the two totals.
- **Item trade history** from RoUtility. Select **View trades** on a Roblox Marketplace asset page to compare item baskets, current Rolimon's totals, and overpay side by side. Expand a record for RoUtility's observation details, RAP, and Value. A local report resolves historical Rolimon's valuations and gives per-item swap, upgrade, and downgrade overpay statistics for exported trades.
- **Reference links** to Rolimon's item, bundle, sales, and player pages. Trade offers and the inventory picker show an external link beside each item's Rolimon's value.
- **Toolbar popup and settings** with Roblox sign-in status, Trades tab detection, an **Open Trades** shortcut, and preferences grouped by feature.
- **Market data MCP** for item lookup, statistics, market history, trade observations, and copy ownership history. `get_trade_context` combines both offers, nominal RAP and Value differences, recent sales, deduplicated proofs, and optional copy history. With screenshot reading enabled, `get_trade_proofs` transcribes both offers, calculates fee-adjusted W/L using the item prices shown in the screenshot, and indexes completed proofs by every item and its mapped face or bundle equivalent. Live Nevos posts, indexed screenshots, and reviewed exports are available through the same lookup. [Windows launcher](tools/mcp/WINDOWS-LAUNCHER.md) · [MCP setup and proof screenshots](tools/mcp/README.md#trade-proofs)
- **Roxol Trade Analysis skill** for assessing a Roblox Limiteds screenshot or described exchange in ChatGPT. Import the [skill ZIP](skills/roxol-trade-analysis.zip) and make the Roxol connector available in the chat. The skill uses market data and comparable exchanges to explain a Win, Fair, or Loss verdict and its confidence. [Skill source](skills/roxol-trade-analysis/SKILL.md)

## Planned features

- **Expanded trade analysis** with partner inventory value when available and gross and net Robux after Roblox fees.
- **Trade navigation and search** with a **Send** shortcut beside **Counter**, links to Rolimon's item and player pages, and copy-specific ownership history when available. Search both inventories by item name or acronym, filter by demand, hold status, or serial where supported, and select the exact copy.
- **Pending-trade inventory checks** for both sides, with per-copy ownership and tradability status, a timestamp, and a **Check again** action.
- **Desktop trade alerts and settings** with separate opt-ins for inbound, declined, and completed trades, click-through to the relevant trade, a test notification, and an option to hide RAP deltas separately.
- **Per-item USD estimates** from RoUtility where available, with a separate optional estimate using a user-entered rate and live Rolimon's value.
- **Mass Trade Sender** with offer selection, manual recipient entry, a review queue, progress tracking, and native trade forms for manual sending. Owner discovery is planned once the data is verified.
- **Marketplace overpay estimates** are planned to use Nevos trade proofs through the same integration as Roxol MCP's `get_trade_proofs`. [Roxol MCP trade proof integration](tools/mcp/README.md#trade-proofs)
- **Expanded market data exports** with reseller depth, resale activity, supply, and trade advertisements. Proof lookup can ship independently. See the [market data acquisition plan](MARKET_DATA_PLAN.md).

**Ideas under consideration** include a **Might drop** forecast that tracks sustained pressure below a value threshold, plus buy, sell, and trade calculators that account for volume, liquidity, outliers, and sparse or stale data.

## Load locally

Enable Developer mode at `chrome://extensions` or `edge://extensions`, then select **Load unpacked** and choose the `extension` folder.

The limited-card **Copy ID** control is disabled while its implementation is kept for future work.

Roxol reuses item and resale helpers from Nevos. [Nevos source license](extension/vendor/nevos/LICENSE)

## Popup preferences

Open Roxol from the toolbar or from the extension's options page. Preferences are saved in the current browser profile and apply to open Roblox tabs as you change them. Features start enabled. **Auto** follows the Roblox theme for in-page Roxol controls and the browser theme for the popup. **Light** and **Dark** apply to Roxol's controls and surfaces.

| Group | Controls |
| --- | --- |
| General | **Enable Roxol** controls all in-page enhancements, including profile and inventory panels. The popup still shows Roblox account status and the **Open Trades** shortcut. |
| Item pages | **Item value** controls value rows and Best Price comparisons. **Demand and trend indicators** controls demand or daily sales, trend, and related item state badges. **Sales history** controls the preview and full viewer on Marketplace and inventory cards and detail pages. |
| Trade pages | **Value and RAP comparisons** controls offer totals, offer demand, deltas, and Roblox trade-list previews. **Item statistics** controls trade and picker card figures, demand and trend, and sales previews. **Projected warnings** controls Rolimon's projected badge independently. |
| Trade history | From Marketplace **View trades**, **Enhanced trade cards** controls the thumbnail layout. **Additional statistics** controls current valuations, basket totals, overpay, and valuation details. The compact item list and JSON export remain available. |

To verify the preferences, leave a Marketplace listing or a trade open while changing its switches in the toolbar popup or extension options. Check that each corresponding feature updates, then reopen the popup to confirm the settings were saved. In the Marketplace trade history viewer, toggle the card layout and statistics while viewing a page. [Edge CDP verification workflow](AGENTS.md)

## Trade list previews

Open Roblox **Trades** while signed in and switch among Inbound, Outbound, Completed, and Closed or Inactive. Compare a row with its selected trade and check that the upper figures are your offer and the lower figures are what you receive. The previews use the trade's Roblox RAP when available and the current item snapshot as a fallback. The value pair uses Rolimon's assigned values or Roxol's usual item fallbacks. Both pairs include any Robux you give and count incoming Robux after the trade fee. A dash marks an unavailable total. Check that switching rows or tabs keeps the figures attached to the right trade. [Edge CDP verification workflow](AGENTS.md)

## Trade offer demand

The **Demand** row on each offer averages Rolimon's 1–5 ratings, counting every rated copy equally. The score displays to one decimal place beside a five-bar icon. The average excludes unrated copies and Robux. Hover over the row for rating coverage. A dash marks offers with zero rated copies.

To verify it, add copies rated 2 and 5 to one side of a send or counter form and check for `3.5/5.0`. Add an unrated copy and check that the score stays at `3.5/5.0` while coverage changes to two of three copies. Change the other offer to verify that each side updates independently, then compare both rows on a selected trade. [Edge CDP verification workflow](AGENTS.md)

## Resale activity badges

Rated items show Rolimon's demand as `1` Terrible, `2` Low, `3` Normal, `4` High, or `5` Amazing. Card badges retain their tier colors. Hover over or focus a card badge to read the tier name. For unrated items, Roxol uses the **Avg Daily Sales** figure from the public Rolimon's item or bundle page when available. Thumbnail badges abbreviate sales per day as `S/D`. Hover over or focus the badge to see the full figure and an explanation of the resale activity metric. A published zero displays as `0.00 S/D`. An unrated item with a Rolimon's entry and no available sales figure shows a neutral `0` on its card. The extension's background worker shares lookups across tabs, caches page results for five minutes, and caches transient failures for 20 seconds.

To verify the demand badge, hover over a rated limited item's Marketplace card and compare the displayed number and tooltip with its Rolimon's tier. To verify the sales fallback, open Epic Egg (`4773569689`) in Marketplace and compare its badge with Rolimon's published figure. Check the same badge on an inventory or trade card that contains an unrated limited item. [Epic Egg on Rolimon’s](https://www.rolimons.com/item/4773569689)

## RoUtility trade history

The **View trades** button appears on limited Marketplace asset pages.

Roxol requests public history from `routility.io` when you open or page through the viewer. Requests send the asset ID and page number without cookies. The viewer requests item thumbnails from Roblox in batches. Each basket sums quantities at current Rolimon’s Value per copy, falling back to current Rolimon’s RAP when there is no positive Value. The viewer shows OP as Side B minus Side A and divides by Side A for OP percentage. If either total is unavailable, the viewer labels the trade **Unpriced trade**. A basket worth more than twice the other is labelled **Severe imbalance**. Expand **Valuation details** to inspect RoUtility’s original RAP and Value, quantities, serials, and item observation times where available. RoUtility cannot see side payments.

**Export viewed trades** downloads JSON for the pages visited since opening the viewer. It includes source page coverage and fetch times, deduplicated trade records, and both item baskets with quantities, available copy IDs, observation times, and RoUtility's RAP and `valueThen`. Missing fields are `null`. An explicit zero remains zero in the export. The export omits participant identifiers and side payments.

Run `node tools/overpay/resolve-trades.mjs trades.json valued-trades.json` with Node.js 22 or later and Edge on Windows. The report includes Rolimon's historical Value or dated RAP, per-item provenance, both basket totals, and signed item-only overpay. It also includes a separate calculation based on current snapshots. See the [historical valuation guide](tools/overpay/README.md#historical-valuation-of-routility-trades) for the cache, timing rules, and sample results.

In the report, `itemOverpay.items` is keyed by asset ID and includes median OP, median percentage OP, quartiles, interquartile range, sample size, observation dates, and valuation and Robux coverage. Statistics cover the last 30 days and all observations in the export. Add `--completed pilot.json` to audit against reviewed Roblox completed-trade evidence, or run `node tools/overpay/validate-trades.mjs trades.json pilot.json audit.json` for the audit alone. [Method and live verification](tools/overpay/README.md#historical-overpay-statistics)

To verify the integration, open Black Iron Antlers (asset `398674411`) in Edge with Roxol loaded. Select **View trades**, browse to the second page, and export the viewed trades. Check the two page entries and the two baskets per trade in the file. [Edge CDP verification workflow](AGENTS.md)

## Contributing

Build trading surfaces, including future proof checkers, inside `.roxol-market` to inherit Roblox's typography and Roxol's neutral theme tokens. Reuse `.roxol-stat-grid` and `.roxol-number` for comparable figures, `.roxol-table` for audit tables, `.roxol-basket-pair` and `.roxol-trade-basket` for opposing baskets, and `.roxol-segments`, `.roxol-disclosure`, `.roxol-progress-bar`, and `.roxol-loading-status` for controls and loading. Apply sign colors to numerical indicators through `data-direction`. [Shared marketplace stylesheet](extension/content/market.css)

After each implementation, update the relevant README files and include those updates in the same commit. Summarize what changed in the commit subject and explain why in the commit body. Push to the corresponding GitHub branch and verify that its tip matches the local commit.
