# Limited-item cards and trade comparison

Build this in three steps from the local `nevos-trading-extension` checkout. Start with the shared card renderer, then use it in the selected Outbound trade before extending it to the other trade views. The selected trade is the first integration test because switching rows exercises both native offer placement and stale data handling.

## 1. Add the shared limited-card widgets

- Put a demand badge in the thumbnail’s upper-left corner. Use yellow for Amazing, purple for High, green for Normal, red for Low and Terrible, and gray for unknown. Include the exact label on hover and keyboard focus.
- Put the state and recent-sales buttons in the upper-right corner. Use the existing Rolimon’s metadata for Projected, Might drop, Might raise, and published trend. Show a neutral icon and the available state label when there is no projection or forecast. Keep published trends distinct from Roxol’s RAP-based estimates in the tooltip.
- Reuse the recent-sales popover and full sales viewer. Keep the newest-first sale marks and their above or below pre-sale RAP colors. Make the popover reachable by hover, keyboard, and tap.
- Show the native Robux amount and Rolimon’s value directly below the thumbnail, in the card’s existing text area. On Marketplace cards, keep the native asking price when present. On trade cards, the native figure is Roblox RAP. Use accessible names for both rows and label a RAP fallback on the Rolimon’s row. Add the copy identifier near the thumbnail’s lower-left corner when the card exposes a verified identifier. Prefer a serial label when present and show the exact copy ID in its details.
- Mount the controls against the thumbnail wrapper and preserve the native item link and Limited badge. Inherit Roblox typography and text color, and use its theme variables where available. Keep any added spacing local to the host card. Reuse the [Roxol card placement](extension/content/market_pages.js:84), [item renderer](extension/content/market_ui.js:589), and [sales popover](extension/content/market_ui.js:508).

## 2. Port selected Outbound trade widgets and comparison

- Resolve the selected trade from Nevos’s `.trade-row-list .trade-row.selected` and row ID logic. Find both native `.trade-list-detail-offer` sections and use the selected trade’s identity throughout loading and rendering. Reuse the [Nevos row ID adapter](nevos-trading-extension/extension/scripts/add_trade_id_to_row.js:1) and [selected trade lookup](nevos-trading-extension/extension/content/trade_page.js:9529).
- Bring over the minimum read-only trade detail and offer normalization logic. Resolve give and receive relative to the signed-in user, since initiator order can flip after counters. Use typed asset or bundle IDs for price lookup and exact instance IDs or UAIDs for copy labels. Follow the [Nevos trade reader](nevos-trading-extension/extension/background/background.js:5499), [offer normalization](nevos-trading-extension/extension/content/trade_page.js:9825), and [card copy lookup](nevos-trading-extension/extension/scripts/trade_bridge.js:733). Leave the copy label blank when two identical cards cannot be matched to their copies reliably.
- Use the existing Roxol item request for Rolimon’s values and sales. Preserve Roblox RAP from the native trade data. Sum each copy on each side, using assigned value or the labeled fallback, with the trade’s Robux handled according to Nevos’s existing post-tax convention. Inspect the native Robux line to avoid applying the fee twice. Keep unknown amounts unknown and withhold a delta when either side’s total is incomplete.
- Place the signed RAP and value chips in the native gap between the offers. Calculate each delta as receive minus give, and calculate its percentage against the give total when that total is positive. Show the signs in text along with green for gains, red for losses, and neutral for zero. Let the chips wrap in a narrow pane. Start from the [Nevos divider hook](nevos-trading-extension/extension/content/trade_page.js:2445), [Robux handling](nevos-trading-extension/extension/content/trade_page.js:3362), and [percentage calculation](nevos-trading-extension/extension/content/trade_page.js:2977). Use the source’s mounting location with an ordinary flow layout so the chips stay above Roblox’s actions.
- Clear the previous comparison as soon as the selection changes. Before rendering an async result, verify the trade ID and both offer elements still match. Preserve the existing toolbar popup’s trade-page detection.

## 3. Reuse the widgets on the remaining Trades views

- Check the same detail integration on Inbound, Completed, and Inactive. Use Nevos’s `.trade-request-window-offer` and `.trade-request-item` hooks for send and counter forms and its inventory card hooks for the picker. Update the comparison when a copy is added or removed or the native Robux input changes. Reuse the [Nevos offer hooks](nevos-trading-extension/extension/content/trade_page.js:20058) and [offer change detection](nevos-trading-extension/extension/content/trade_page.js:17413).
- Keep the widgets read-only and scope the comparison to the two displayed offers.

## Manual Edge checks

Reload Roxol at `edge://extensions` and refresh the Roblox tab after each implementation step. Run the signed-in Edge checks by hand.

1. On Marketplace, open a page with limited cards. Check that the native price and Rolimon’s value sit beside the existing item text. Hover or tab to the demand, state, and sales controls. Check that a regular item has no overlays and that the native link still opens.
2. In **Trades → Outbound**, open a trade with limited items on both sides. Compare the card values and both deltas with the offers, then switch quickly between two trades. Check that the old values clear and that the chips remain between the offers, above the native action area.
3. If available, check an offer with two copies of the same item, one with Robux, and an offer with a RAP-only item. Confirm copy labels follow the specific copy, the fee is counted once, and the RAP fallback is labeled. Narrow the Edge window and repeat the placement and hover checks.
4. Open an Inbound or Completed trade and preview a counter form. Check that adding or removing an item and editing Robux updates the comparison. Leave the form without submitting it.
