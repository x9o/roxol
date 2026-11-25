# Overpay analytics

Use Rolimon’s [`#value-requests`](https://discord.com/channels/415246288779608064/535250426061258753) as the first live source. Use RoPost’s Proof Checker to cross-check the pilot sample. The alt can already open the channel in Edge. An initial read found proof images, moderation notices, compact `S:` / `R:` / `D:` labels, and both month-first and day-first dates. Automated reads and historical pricing coverage still need verification.

## 1. Collect a live sample on demand

- Build a local, read-only collector that opens the channel in a dedicated persistent Edge profile. The user signs in to their alt in that profile once. Before collecting, verify the expected account and channel. If Discord prompts for sign-in, stop and explain how to resume. Keep the profile and collected data outside the repository and keep authentication in the browser.
- Start with an on-demand command. Each run catches up from the last recorded Discord message and rereads a small overlap for edits. Save the original message ID and link, Discord post and edit timestamps, message text, and evidence images in local storage. Store the message ID and attachment IDs alongside the images. Advance the checkpoint only after the batch is saved. A retry should update the same records without skipping or duplicating posts.
- Read 50–100 recent live messages, then run the collector again with the same profile. Check session reuse, catch-up, and deduplication. Inspect proof coverage for one liquid, one mid-volume, and one rare item. Summarize moderation posts, posts with usable trade data, duplicate trades, completed proofs, isolated targets, eligible submitted totals, and coverage for historical cross-checks.
- Add an optional Windows schedule once catch-up works. The next run can read posts that are still in the channel after the PC has been off. Consider a private hosted VM later if collection needs to run while the PC is off.

## 2. Parse proof posts and confirm both trade sides

```text
Item(s): <name or acronym>
Values: <side A> vs <side B>
Sender: <Roblox username>
Receiver: <Roblox username>
Date: <trade date>

<trade screenshot>
```

- Use the post text first. Accept short labels, `v` and `vs`, `k` and `m` amounts, quantities, and omitted fields. Keep raw text alongside normalized fields. Resolve names and acronyms to typed Roblox IDs. Flag missing units and ambiguous dates for review. Use the screenshot or other dates in the same proof when they resolve the ambiguity. Store the trade date separately from the Discord post timestamp.
- Read both screenshot baskets, including small adds, quantities, and any visible Robux. Use OCR or image extraction where the text leaves these unclear. Verify that the evidence shows a completed trade before including it in the primary sample. Record any demonstrated staff review separately from the submission and completion status.
- Deduplicate by an actual trade ID when present. Otherwise match reposts using the trade date, participants, both normalized item baskets, and any visible Robux or copy IDs. Use matching evidence images to help identify reposts. Keep uncertain matches for review and retain the original source links for merged records.
- Keep the supplied formatting examples as regression cases. Ice Valkyrie with Perfectly Legitimate has **+13k** on the submitted totals, with 330k opposite the 317k basket. It is evidence for a bundled target. Fuchsia Fantastique is isolated and shows **+5k**, with 155k opposite 150k. Scissors is explicitly named because its 100k value exceeds half of Fuchsia Fantastique’s 150k value. Use the target’s position in the screenshot to orient the calculation in both examples.

## 3. Aggregate submitted OP and cross-check historical values

- Use the two submitted totals for the primary benchmark. Include unique completed trades where one copy of the target is alone on its side, the screenshot confirms an item-only exchange, and both submitted totals can be matched to the correct sides. Flag missing or ambiguous totals for review. Preserve both submitted totals and calculate signed OP as **submitted opposing total − submitted target total**. Keep one-for-one swaps separate from one-for-many benchmarks. In a one-for-many trade, acquiring the single item is the upgrade perspective and giving it up is the downgrade perspective. Count the trade once for the target item. Inspect proofs with visible Robux during the pilot to establish how their amounts and fees are represented.
- When both baskets have complete history, recalculate OP using Rolimon’s assigned values in effect at the time of the trade and record the difference from submitted OP. Record the value source and effective timestamp for each item. If a date-only proof falls on a day with a relevant value change, resolve the timestamp from the evidence or mark the historical cross-check unavailable. Report historical coverage alongside the cross-check results. Proofs that meet the primary criteria qualify even when historical pricing is incomplete. [Example Rolimon’s value history](https://www.rolimons.com/item-value-changes/19027209)
- Show median OP, mean OP, the middle 50% range, sample count, date window, last successful collection, and links to the source posts. Start by evaluating a 30-day window with a provisional minimum of 10 unique eligible trades per item and trade shape. Show the sample count for thinner groups and require sufficient coverage in both windows before showing a trend. Use pilot counts to revise these display thresholds.
- Label the primary result **Based on submitted values** and explain that voluntary submissions can overrepresent unusually high overpays. Keep historical cross-check values out of the submitted aggregates. If RoUtility is tested later, compare results across imbalance cutoffs and report how many trades each cutoff removes. Give inferred OP its own benchmark and sample count.

## 4. Integrate with Roxol after the pilot

- Use the existing item detail and trade analysis surfaces. Ship the item benchmark and proof links first. In trade views, show the benchmark only when an isolated target and the comparison trade shape can be identified, with the correct upgrade or downgrade perspective. Keep missing and stale states explicit and the existing trade totals visible. [Item page](extension/content/market_pages.js) · [Trade page](extension/content/trade_page.js)
- Define a versioned per-item lookup for aggregates and proof links. The first integration can use a read-only loopback service over the local database. Roxol’s background worker can query it when configured and report the last sync time if it is unavailable. Keep session credentials and raw evidence in the collector. Decide on hosted publication separately if a shared dataset becomes useful.
- Validate parser and statistics with fixtures for shorthand, ambiguous dates or totals, duplicate submissions, and same-day value changes. Include a proof that qualifies with a missing historical price and one that shows the difference between submitted and recalculated OP. Verify live collection separately against the alt and spot-check records against the source images. Use the workspace’s headless Edge CDP workflow to check Roxol on desktop and narrow layouts, including sparse and stale data and rapid changes to the selected trade. Report which checks used live data and which used fixtures. [Workspace verification](AGENTS.md)

Revisit the sustained **Might drop** forecast and calculators once the pilot establishes usable coverage across different liquidity levels.
