# Connector fields and follow-up tools

## Whole-trade request and response

- `give` and `receive` each accept `items` and gross integer `robux`. A side supports up to four copies. Item strings accept an exact name, acronym or numeric asset ID. Objects take `id` or `query`, optional `kind: "bundle"` and `quantity`. Keep numeric IDs as strings. A known copy uses a separate quantity-one entry with `uaid` or `collectibleInstanceId`. A copy ID alone can resolve its asset through RoUtility. A `tradeId` alone records a reference and yields an unavailable lookup because the public connector lacks an authorized Roblox session. Supply the baskets.
- `proofLimit` defaults to 3 per distinct item, up to 10. `ownershipLimit` defaults to 0 and accepts up to 20 observations per known copy. Choose a modest limit when assessing identified copies. An item-only or partial request can return useful evidence, with no full-trade difference unless both sides and metrics resolve.
- Read `structuredContent` when the text content is empty. Resolve each side entry's `item` key into `items`, such as `asset:19027209`. Read `resolution`, `matches`, `copyStatus` and source status before trusting totals. A missing price or unresolved entry makes the affected totals and `nominalWL` metric null. Use fresh market data for a present-day assessment and keep `rapProvider` and `valueBasis` visible when they matter. Value can be Rolimon's assigned Value, RoUtility assigned Value, a Rolimon's fallback, or RAP.
- `itemRap` and `itemValue` exclude Robux. `totalRap`, `totalValue` and `nominalWL` include full outgoing Robux and incoming Robux net of the 30% fee. The connector rounds the incoming amount to the nearest Robux. When the screenshot explicitly gives net incoming Robux, add it once to the item-only figures. Label a gross versus net ambiguity if it affects the comparison.
- The compact snapshot provides up to three Rolimon's tracked sales, seven Roblox daily resale records, and one Rolimon's Value change. It can include demand, trend, flags, copies, daily sales and best price. Follow zero-based pointers into `sources` for each provider URL, status and check time. `checkedAt` is a retrieval timestamp. Missing, empty, unsupported and unavailable evidence have different meanings. Item proof `postIds` reference the shared `proofs` map. A side entry's `copy.history` references the top-level `ownership` map when returned.

## Targeted follow-up

| Tool | Use when |
| --- | --- |
| `find_items` | An exact-name lookup gave no match or multiple matches. Check the candidate name and kind before passing a resolved ID to another tool. |
| `get_item_stats` | The compact data leaves an important pricing, supply, or demand question, or provider-specific figures disagree. |
| `get_market_history` | Use `rolimons_value_changes` for a dated benchmark, `rolimons_sales` for individual sales with RAP context when available, or `roblox_resale` for daily price and volume. A daily resale price is a separate series from historical RAP. |
| `get_trade_proofs` | A comparable item's proof sample is truncated or too shallow, or the trade-context caption was truncated. Prefer a resolved ID and kind. |
| `get_trade_proof_image` | Inspect the original screenshot when a candidate comp's caption leaves direction, fees or pricing ambiguous. Pass the attachment reference returned by `get_trade_proofs`. Use the image labels and amounts to establish what the record supports. |
| `get_trade_observations` | Seek a relevant RoUtility ownership-transfer observation by asset ID, including corroboration when proof records are thin. Its inferred flag describes the provider's method. Even `inferred: false` leaves completion and side payments unconfirmed. |
| `get_copy_history` | Check a specific copy by one UAID or one collectible instance UUID when a fuller timeline could resolve a material question. Verify the returned asset and copy identifiers. |

Pages start at 1. Proof and market history pages accept up to 50 records, and RoUtility trade observations return a fixed 20 per page. Follow pagination only where the next page can answer the specific question. Copy history rows are tracker observations. Repeated sightings, hidden owners and same-timestamp previous-owner markers can reflect how the tracker reports an event. Count distinct supported changes and describe gaps in coverage.
