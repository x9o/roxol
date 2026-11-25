# Roxol

Roxol is a Chrome and Edge extension for Roblox limited items and trading. It uses live data from Roblox and Rolimon's.

## Current features

- **Item insights** on supported Marketplace cards, item and bundle detail pages, and inventory cards. See Recent Average Price (RAP), Rolimon's assigned value or a labeled fallback, demand, published trend, and rare or projected flags where available. **Might raise** and **Might drop** compare the current RAP snapshot with value-tier thresholds. Detail pages compare Roblox's Best Price with RAP and assigned value.
- **Sales history** with an interactive preview and a full viewer. See tracked sale dates, estimated prices, RAP before and after each sale, how often sales exceeded pre-sale RAP, and how the median prices for the last 10 and 30 tracked sales compare with assigned value and Best Price. The full viewer also includes Roblox's daily resale prices and volume where available.
- **Profiles and inventories** with RAP and value totals for loaded copies, a paginated breakdown, serial numbers where available, and RoliBadges. Eligible profiles can show a **Trade Items** shortcut in narrow layouts.
- **Reference links** to Rolimon's item, bundle, sales, and player pages and a **View trades** link to RoUtility on Roblox item pages.
- **Toolbar popup and settings** with Roblox sign-in status, Trades tab detection, an **Open Trades** shortcut, and a saved system, light, or dark appearance preference.

## Planned features

- **Trade analysis** on trade lists, trade details, and send and counter forms. Show per-item RAP and value, totals for both sides, partner inventory value when available, win/loss previews and deltas, and gross and net Robux after Roblox fees. Bring item badges and sales history into trades.
- **Trade navigation and search** with a **Send** shortcut beside **Counter**, links to Rolimon's item and player pages, and copy-specific ownership history when available. Search both inventories by item name or acronym, filter by demand, hold status, or serial where supported, and select the exact copy.
- **Pending-trade inventory checks** for both sides, with per-copy ownership and tradability status, a timestamp, and a **Check again** action.
- **Desktop trade alerts and settings** with separate opt-ins for inbound, declined, and completed trades, click-through to the relevant trade, a test notification, feature toggles, and an option to hide RAP deltas.
- **Per-item USD estimates** from RoUtility where available, with a separate optional estimate using a user-entered rate and live Rolimon's value.
- **Mass Trade Sender** with offer selection, manual recipient entry, a review queue, progress tracking, and native trade forms for manual sending. Owner discovery is planned once the data is verified.

- **Overpay (OP) analytics** on item pages and trade analysis views. Display median and mean observed OP, typical ranges, sample sizes, recent trends and source proofs, separating upgrades and downgrades. Prefer trades where the target item is isolated on one side, using values at the time of the trade where available.

### Overpay analytics: proposed data sources

1. **Discord value requests:** Investigate collecting Rolimon's value-request messages and proof attachments, extracting structured trade records (including OCR if needed) into a searchable database. Submitted and reviewed proofs are the preferred evidence, but building a reliable dataset may be difficult.
2. **Rolimon's / RoPost API:** Investigate whether either service offers a proof-data API. RoPost's Discord bot already supports item-specific proof searches, making it the main lead; its underlying data source and retrieval method are unknown. A suitable public API may not exist.
3. **RoUtility API:** Practical alternative if structured proof data is inaccessible. Use available tracked trades and investigate configurable value-imbalance thresholds to exclude probable USD purchases and other anomalous exchanges. Thresholds cannot reliably identify all off-platform payments and may exclude legitimate trades, so label these statistics as inferred rather than proof-backed and keep them separate from verified-proof analytics.

No source or implementation has been selected yet. Verify API availability, historical values, duplicate handling and sample quality before implementation. Submitted proofs may also have selection bias.

**Ideas under consideration** include a **Might drop** forecast that tracks sustained pressure below a value threshold, plus buy, sell, and trade calculators that account for volume, liquidity, outliers, and sparse or stale data.

## Load locally

Enable Developer mode at `chrome://extensions` or `edge://extensions`, then select **Load unpacked** and choose the `extension` folder.

Roxol reuses item and resale helpers from Nevos. [Nevos source license](extension/vendor/nevos/LICENSE)
