# Roxol

Roxol is a Chrome and Edge extension for Roblox limited items and trading. It uses live data from Roblox, Rolimon's, and RoUtility.

## Current features

- **Item insights** on supported Marketplace cards, item and bundle detail pages, and inventory cards. See Recent Average Price (RAP), Rolimon's assigned value or a labeled fallback, demand, published trend, and rare or projected flags where available. **Might raise** and **Might drop** compare the current RAP snapshot with value-tier thresholds. Detail pages compare Roblox's Best Price with RAP and assigned value.
- **Sales history** with an interactive preview and a full viewer. See tracked sale dates, estimated prices, RAP before and after each sale, how often sales exceeded pre-sale RAP, and how the median prices for the last 10 and 30 tracked sales compare with assigned value and Best Price. The full viewer also includes Roblox's daily resale prices and volume where available.
- **Profiles and inventories** with RAP and value totals for loaded copies, a paginated breakdown, serial numbers where available, and RoliBadges. Eligible profiles can show a **Trade Items** shortcut in narrow layouts.
- **Trade comparisons** on selected trades and send and counter forms. Each offer shows its Rolimon's total below the native total, which is labeled `(RAP)`. The Rolimon's total uses the same item fallbacks and Robux amounts as the value comparison. Limited-item cards show Roblox RAP, Rolimon's value or a labeled RAP fallback, and demand, state, and sales history where available. Centered badges between the offers show signed RAP and value changes, with Robux and Rolimon's icons and green and red indicators for gains and losses.
- **Local overpay benchmarks** on item and trade pages. The opt-in pilot shows sample counts, date windows, and source posts for observed submitted-proof overpay. Summary statistics appear once a trade shape has at least 10 eligible proofs.
- **Item trade history** from RoUtility. Select **View trades** on a Roblox Marketplace asset page to see both sides of tracked exchanges, their observation times, and item RAP and historical Value where available. Use **Previous** and **Next** to browse or **View on RoUtility** to open the source.
- **Reference links** to Rolimon's item, bundle, sales, and player pages.
- **Toolbar popup and settings** with Roblox sign-in status, Trades tab detection, an **Open Trades** shortcut, and a saved system, light, or dark appearance preference.

## Planned features

- **Expanded trade analysis** with trade-list win/loss previews, partner inventory value when available, and gross and net Robux after Roblox fees.
- **Trade navigation and search** with a **Send** shortcut beside **Counter**, links to Rolimon's item and player pages, and copy-specific ownership history when available. Search both inventories by item name or acronym, filter by demand, hold status, or serial where supported, and select the exact copy.
- **Pending-trade inventory checks** for both sides, with per-copy ownership and tradability status, a timestamp, and a **Check again** action.
- **Desktop trade alerts and settings** with separate opt-ins for inbound, declined, and completed trades, click-through to the relevant trade, a test notification, feature toggles, and an option to hide RAP deltas.
- **Per-item USD estimates** from RoUtility where available, with a separate optional estimate using a user-entered rate and live Rolimon's value.
- **Mass Trade Sender** with offer selection, manual recipient entry, a review queue, progress tracking, and native trade forms for manual sending. Owner discovery is planned once the data is verified.

- **Expanded overpay analytics** with a primary benchmark based on verified proofs and their submitted totals. Complete Rolimon's historical pricing will support a cross-check. More proof coverage, a RoPost cross-check, and sales-based lookback windows are also planned. See the [overpay analytics plan](OVERPAY_ANALYTICS_PLAN.md).
- **Expanded market data exports** with cross-checked historical valuations, item-only overpay summaries, reseller depth, resale activity, supply, and trade advertisements. Proof lookup can ship independently. See the [market data acquisition plan](MARKET_DATA_PLAN.md).

**Ideas under consideration** include a **Might drop** forecast that tracks sustained pressure below a value threshold, plus buy, sell, and trade calculators that account for volume, liquidity, outliers, and sparse or stale data.

## Load locally

Enable Developer mode at `chrome://extensions` or `edge://extensions`, then select **Load unpacked** and choose the `extension` folder.

The limited-card **Copy ID** control is disabled while its implementation is kept for future work.

Roxol reuses item and resale helpers from Nevos. [Nevos source license](extension/vendor/nevos/LICENSE)

## RoUtility trade history

Roxol requests public history from `routility.io` when you open the viewer or change pages. Requests send the asset ID and page number without cookies. RoUtility reports when it observed the exchanges and cannot see side payments. Missing RAP or historical Value appears as a dash.

**Export viewed trades** downloads JSON for the pages visited since opening the viewer. It includes source page coverage and fetch times, deduplicated trade records, and both item baskets with available copy IDs, observation times, RAP, and historical Value. Missing fields are `null`. The export omits participant identifiers and side payments.

To verify the integration, open Black Iron Antlers (asset `398674411`) in Edge with Roxol loaded. Select **View trades**, browse to the second page, and export the viewed trades. Check the two page entries and the two baskets per trade in the file. [Edge CDP verification workflow](AGENTS.md)

## Contributing

After each implementation, update the relevant README files and include those updates in the same commit. Summarize what changed in the commit subject and explain why in the commit body. Push to the corresponding GitHub branch and verify that its tip matches the local commit.

## Local overpay pilot

Roxol can compare observed submitted-proof overpay for isolated limited items. The pilot uses the Rolimon's Discord proof channel and Rolimon's historical assigned values. An independent cross-check with RoPost's Proof Checker is pending.

1. Run `node tools/overpay/sign-in.mjs` from the workspace root. Sign in to the Discord alt in the dedicated Edge window, confirm that it can open **#value-requests**, and close that window.
2. Run `node tools/overpay/collect.mjs <discord-username> 75` with Node 22 or later. The first run reads the latest 75 posts. Subsequent runs reuse that profile, catch up from the saved checkpoint, and reread 12 posts for edits. A collection aborts if it cannot reach the overlap or save an attachment.
3. Run `node tools/overpay/analyze.mjs` to produce `pilot.json`. Add `--ocr` if Tesseract is on PATH and you want OCR text alongside unreviewed attachments. Inspect the saved images. Check the completed status, both item baskets, the amounts of Robux, the trade date, and any visible copy or trade IDs. Record a demonstrated staff decision separately. Compare a liquid, a mid-volume, and a rare item with RoPost's `/proof` results and record what matched or differed.
4. Add verified posts to `reviews.json` using the format below and rerun the analyzer. It reports coverage, exclusions, duplicates, per-item results, and the historical values used. It also writes `benchmarks.json`.
5. Run `node tools/overpay/serve.mjs` and enable **Local overpay benchmarks** in Roxol's preferences. Reload the Roblox tabs you want to check. The service listens on `127.0.0.1:43127` and serves aggregate statistics and source post links. Roxol marks benchmarks as stale after three days and shows the last successful collection when the service is unavailable.

These commands use `%LOCALAPPDATA%\Roxol\overpay` by default. Set `ROXOL_OVERPAY_DIR` to use a different directory outside the workspace. Discord authentication stays in the dedicated Edge profile. Messages, evidence images, and review records are local. Discord may show that a message was edited without exposing an exact edit timestamp. Those records retain the edited flag and an empty timestamp.

The [collector guide](tools/overpay/README.md) covers backfilling older posts in batches of up to 200.

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

The benchmark uses a rolling 30-day window and needs 10 eligible trades per item and trade shape. A trend needs 10 in the previous window as well. Voluntary submissions can overrepresent unusually high overpays. Run the analytics fixtures with `node tools/overpay/analytics.test.mjs`.

If a post contains multiple completed trades, use an array of review entries for that message ID and give each entry its matching attachment hash. Use `robuxBasis` to record whether the screenshot shows an offered amount or an amount after the fee. Use `serial` for a visible serial number and `copyId` for an actual copy ID.

### Optional daily Windows collection

After verifying the on-demand collector and its second run, you can register a daily Task Scheduler job from the workspace root. It runs as your Windows user while signed in and starts after a missed run when Windows is next available. The example uses 7 PM local time.

```powershell
$roxolRoot = (Get-Location).Path
$roxolNode = (Get-Command node).Source
$roxolAction = New-ScheduledTaskAction -Execute $roxolNode -WorkingDirectory $roxolRoot `
  -Argument 'tools/overpay/collect.mjs --use-current-account 75'
$roxolTrigger = New-ScheduledTaskTrigger -Daily -At 7pm
$roxolSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Roxol Overpay Collection' -Action $roxolAction `
  -Trigger $roxolTrigger -Settings $roxolSettings -User "$env:USERDOMAIN\$env:USERNAME" -RunLevel Limited
```

The scheduled job uses the account saved by the first successful collection. After reviewing newly collected proofs, rerun the analyzer to publish an updated benchmark.
