# Roxol market data MCP

Roxol serves live public limited-item data through a stateless Streamable HTTP endpoint at `/mcp`. It runs in one Node.js process with in-memory caches. The tools return JSON with source URLs, observation timestamps where available, provider status, and pagination. ChatGPT supplies the analysis.

## Windows quick start

You need Node.js 22 or newer, a local copy of Roxol, and access to **Add custom MCP server** in ChatGPT. After installing the dependencies, use the [double-click Windows launcher](WINDOWS-LAUNCHER.md) to start Roxol with a fixed ngrok URL or a temporary Cloudflare Quick Tunnel. The manual Cloudflare setup below uses two PowerShell windows. Your PC must stay on, awake, and online while you use Roxol. You can lock the screen.

### 1. Install once

Open the Roxol folder and install the server dependencies. Adjust the path if you cloned Roxol elsewhere.

```powershell
Set-Location "$env:USERPROFILE\Desktop\roxol"
node --version
npm.cmd ci --prefix tools/mcp
```

If PowerShell says `cloudflared` is unrecognized, download the portable x64 build into your user folder. If you already have `cloudflared` on your PATH, skip this download. [Cloudflare Windows downloads](https://developers.cloudflare.com/tunnel/downloads/)

```powershell
$bin = Join-Path $env:LOCALAPPDATA 'Roxol\bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$cloudflared = Join-Path $bin 'cloudflared.exe'
curl.exe --fail --location --output "$cloudflared" 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
if ($LASTEXITCODE -eq 0) { & $cloudflared --version }
```

### 2. Start the tunnel

Run this in the first PowerShell window. It uses `cloudflared` from your PATH if available and otherwise looks for the portable copy from step 1.

```powershell
$cloudflared = (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
    $cloudflared = Join-Path $env:LOCALAPPDATA 'Roxol\bin\cloudflared.exe'
}
& $cloudflared tunnel --url http://127.0.0.1:8787 --protocol http2
```

Copy the HTTPS URL ending in `.trycloudflare.com` and leave this window open. Anyone with that URL can query the public data Roxol serves. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

### 3. Start Roxol

In the second PowerShell window, replace the example hostname with the one printed by the tunnel. Use just the hostname, without `https://` or `/mcp`.

```powershell
Set-Location "$env:USERPROFILE\Desktop\roxol"
$env:PORT = '8787'
$env:ROXOL_MCP_BIND = '127.0.0.1'
$env:ROXOL_MCP_PUBLIC_HOST = 'your-tunnel.trycloudflare.com'
npm.cmd start --prefix tools/mcp
```

Wait for `Roxol MCP listening at http://127.0.0.1:8787/mcp` and leave this window open. If you get `EADDRINUSE`, choose another port and use it in both the tunnel command and `$env:PORT`.

Roxol also reads an optional `tools/mcp/.env` file on startup, whether you use npm or run `server.mjs` directly. Use one `NAME=value` per line for settings such as `PORT`, `ROXOL_MCP_PUBLIC_HOST`, and `ROXOL_PROOFS_TOKEN`. Git ignores this file. Variables already set in the launching environment take precedence.

### 4. Connect in ChatGPT

Open **Plugins → Add → Add custom MCP server** in ChatGPT. [OpenAI connection settings](https://developers.openai.com/api/docs/guides/custom-mcp-server)

| Field | Value |
| --- | --- |
| Name | Roxol |
| Description | Look up Roblox limited item stats, resale history, public trade observations, and copy ownership history from Rolimon's, RoUtility, and Roblox. |
| Connection | **Server URL** |
| Server URL | Your tunnel's HTTPS URL followed by `/mcp`, such as `https://your-tunnel.trycloudflare.com/mcp` |
| Authentication | **No authentication** |

Create and install the plugin. Check that ChatGPT lists seven tools, then select **@Roxol** in a chat and ask for the current stats for Black Iron Antlers. If discovery fails, check that both PowerShell windows are running and that the plugin URL uses the current hostname and ends in `/mcp`.

### Use the trade analysis skill

In a ChatGPT workspace with skill uploads enabled, open **Plugins → Skills → Add → Upload from your computer** and choose the [Roxol Trade Analysis ZIP](../../skills/roxol-trade-analysis.zip). With the Roxol connector available in the chat, attach a Limiteds trade screenshot or describe what you give and receive. The skill starts with `get_trade_context` to calculate fee-adjusted overpay. It uses `get_trade_proofs` to expand the comparable sample when needed and `get_trade_proof_image` to resolve ambiguous proof terms. Market-history follow-ups support liquidity and downside analysis when the compact snapshot lacks enough context. [Skill source](../../skills/roxol-trade-analysis/SKILL.md) · [Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt)

### Stop or restart

Press **Ctrl+C** in each PowerShell window to stop Roxol and the tunnel. Next time, start at step 2. Each Quick Tunnel restart generates a new hostname. Use it when starting Roxol and update the server URL in ChatGPT.

For a stable URL, use a named tunnel pointing at the same loopback address. For access while your PC is off, run Roxol on an always-on host. A managed host can set `ROXOL_MCP_BIND=0.0.0.0` and `ROXOL_MCP_PUBLIC_HOST` to its public hostname. [Named tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)

## Tools

| Tool | Data |
| --- | --- |
| `find_items` | Find limiteds by ID, name, or acronym in the Rolimon's and RoUtility item feeds. Results include asset or bundle kind. |
| `search_limiteds` | Filter and rank Rolimon's Limited assets and bundles by price, demand, trend, liquidity, historical change, or discount to Value. Returns the metric used for each rank and recent sale evidence. |
| `get_item_stats` | Provider-specific snapshots with RAP, assigned Value, demand, trend, flags, supply where published, and Roblox Best Price. RoUtility's `usdEstimate` and `priceBasis` are provider estimates. |
| `get_trade_context` | Whole-trade evidence with both baskets, RAP and Value totals, recent market activity, shared proof posts, and optional copy history. |
| `get_market_history` | Choose `rolimons_sales` for tracked sales with pre- and post-sale RAP, `rolimons_value_changes` for dated Value changes, or `roblox_resale` for daily prices, volume, and current Roblox resale RAP. |
| `get_trade_observations` | One RoUtility page of 20 records, with both baskets, copy identifiers where published, observed timestamps, RAP, Value and the provider's `inferred` flag. These are ownership-transfer observations with unknown trade completion and side payments. |
| `get_copy_history` | RoUtility's tracked ownership observations for one copy by UAID or collectible instance UUID. Returns timestamps and available public owner identifiers, newest first. |
| `get_trade_proofs` | Proofed trades from the `value-requests` channel in Rolimon's official Discord by ID, item name, or acronym. Roxol searches Discord directly and includes reviewed exports and indexed screenshots when available. Set `readScreenshots` to transcribe new attachments. |
| `get_trade_proof_image` | One original trade proof screenshot, returned as MCP image content for clients that support it. |

Numeric IDs are decimal strings. Item tools default to `asset` and also accept `bundle` where a provider supports it. History and proof pages start at 1, default to 20 records, and accept up to 50 per page. Roblox daily history covers up to 180 returned days. Rolimon's may report more tracked sales than its page includes. Live provider data can shift between page requests. Amounts are in Robux except for fields that explicitly name another currency. A JSON `null` marks an unreported field. Per-source statuses distinguish absent items and unsupported coverage from upstream failures.

The Node process and the extension run independent instances of the same public data layer. The layer deduplicates in-flight calls, caps concurrent upstream requests at four, times requests out, and caches snapshots for up to five minutes. RoUtility trade pages use a two-minute cache. Requests to the three providers omit cookies. The MCP process can start without a browser, Discord session, or Roblox session. It exposes no trading actions.

### Search and rank Limiteds

Pass any combination of filters to `search_limiteds`. The tool returns up to 10 items by default and accepts a `limit` of 1–25.

| Request | Tool arguments |
| --- | --- |
| Most liquid at 100k–250k Value with High or Amazing demand, excluding gear and projected items | `{"price":{"basis":"value","min":100000,"max":250000},"demand":["High","Amazing"],"excludeGear":true,"excludeProjected":true,"sort":"sales","limit":10}` |
| Biggest 7-day Value gains across the catalog | `{"change":{"basis":"value","days":7,"direction":"rising"},"sort":"change"}` |
| Stable items with falling 30-day RAP and at least five sales | `{"trend":["Stable"],"change":{"basis":"rap","days":30,"direction":"falling"},"sales":{"days":30,"minSold":5}}` |
| Listed under 200k and at least 5% below Value, ranked by 30-day sales | `{"price":{"basis":"lowest_ask","max":199999},"minDiscountPercent":5,"sales":{"days":30},"sort":"sales"}` |

- **Price and labels.** Price bounds are inclusive. Choose `value` for Rolimon's assigned Value, `rap` for its RAP, or `lowest_ask` for Roblox's lowest resale listing. Demand and trend arrays accept Rolimon's displayed labels. The exclusions require a known non-projected status and, for assets, a known non-gear asset type.
- **Resales.** `sales.days` accepts 7 or 30 and defaults to 30. `sales.roblox` reports copies sold across the last completed UTC days and the latest day with positive volume in that window. `sales.tracked` supplies a median from individually priced Rolimon's sales in the trailing window, the sample size and coverage, the latest tracked timestamp, and up to three recent sale prices. Use the source and coverage to interpret gaps.
- **Change.** `change.days` accepts 1–180. `change.direction` optionally selects `rising` or `falling`. The start figure comes from Rolimon's Value log or a tracked pre- or post-sale RAP reading around the cutoff. The end figure comes from the current Rolimon's feed. Results show both figures, the Robux and percentage difference, the latest assigned Value change date where available, and Rolimon's current trend label.
- **Asks and discounts.** `lowestAsk.checkedAt` is when Roxol read the catalog snapshot. `discountPercent` is 100 × (assigned Value − lowest ask) ÷ assigned Value. A positive number means the ask is below assigned Value. The results include the recent tracked sale prices alongside it.
- **Sort order and coverage.** Choose `value`, `rap`, `lowest_ask`, `demand`, `sales`, `change` (Robux), `change_percent`, or `discount`. The default follows the first supplied option in this order: change window, sales window, discount threshold, price basis, then assigned Value. The default order is descending except for lowest ask and change sorts filtered to falling. Pass `order` to override it.

For assigned Value change, Roxol first reads Rolimon's [market-wide changelog](https://www.rolimons.com/valuechanges). When it spans the cutoff, Roxol evaluates the entire eligible catalog in one call for searches without a volume sort or minimum volume. It measures net change across all recorded moves in the window, treats items with no recorded changes in a covered window as flat, and checks the last assignment against the current feed. It falls back to per-item history for conflicting records or uncovered windows. `sources.valueChangeLog` reports the source and window coverage.

When a search requires per-item history across the catalog, Roxol evaluates up to 60 candidates per call after applying the snapshot filters. Volume searches evaluate higher demand first. Candidate ordering then uses higher Value or RAP, with names and IDs breaking ties. A `partial` result flags a subset or missing required upstream data. `scope` reports coverage and `matched` counts matches in the evaluated batch. If `scope.nextCandidateOffset` is present, reuse the same inputs with that offset and compare `sortValue` across batches for a combined shortlist. Live snapshots can move between calls.

`scope.changeGaps` identifies each candidate whose change could not be measured, with its source and reason. When Rolimon's Value history returns HTTP 429, Roxol pauses new Value-history requests for the upstream `Retry-After` interval and continues using cached histories. `scope.retryAt` gives the earliest UTC time to rerun the same search and `candidateOffset`. Use the refreshed results for that page before advancing to `nextCandidateOffset`. `get_market_history` also reports `rate_limited` and `retryAt` for affected Value history lookups.

### Whole-trade context

`get_trade_context` returns its result in `structuredContent` with an empty `content` array.

```json
{
  "give": { "items": ["SKOTN"], "robux": 0 },
  "receive": { "items": ["Black Iron Antlers", { "id": "19027209" }], "robux": 100 },
  "proofLimit": 3,
  "ownershipLimit": 0
}
```

Pass both sides from your perspective. Strings accept exact names, acronyms, or numeric asset IDs. Objects accept `id` or `query`, optional `kind: "bundle"`, and optional `quantity`. Each side supports up to four copies. Add a `uaid` or `collectibleInstanceId` to a single-copy entry, or provide just a copy ID to resolve its asset through RoUtility. Asset IDs by themselves identify item types. When a name is ambiguous, the response includes matching candidates.

Each distinct item has one entry in `items`. It includes RAP, Value with its valuation basis, demand and trend where available, up to three tracked sales, seven Roblox daily resale observations, and the latest Rolimon's Value change. RAP uses Rolimon's, Roblox catalog, Roblox resale, then RoUtility in order of availability. Value uses assigned Rolimon's Value, positive RoUtility Value, Rolimon's fallback, then RAP. `nominalWL` is received minus given for each metric. Enter gross offered Robux on each side. Totals include the full amount given and the expected amount received after the 30% fee, rounded to the nearest Robux. A missing price or unresolved item makes the affected metric's total and difference `null`. [Roblox trading guide](https://en.help.roblox.com/hc/en-us/articles/203313310-Trading-on-Roblox)

`proofLimit` defaults to 3 per item and accepts 0–10. Items reference posts by ID in the shared `proofs` object. Each post can include the original Discord post, already indexed `screenshots`, and reviewed evidence. `ownershipLimit` defaults to 0 and accepts up to 20 observations per identified copy. It reuses `get_copy_history` data, combines repeated owner observations, and includes an availability status when a copy lookup fails. Tracker gaps limit what the ownership timeline can establish. Numeric source references index the top-level `sources` array. Each entry includes availability, a source URL, and a check timestamp when known.

An optional `tradeId` records the trade reference and reports lookup availability. The same cookie-authenticated Roblox detail endpoint handles inbound and outbound trade IDs. The Roxol extension uses the signed-in account to orient the offers and reads the UAID or collectible instance ID when Roblox includes it. A signed-out request returned HTTP 401, and a signed-in inbound or outbound trade was unavailable for live verification. The public MCP runs independently of the browser session, so supply the baskets and any known copy IDs for trades you want it to evaluate. [Roblox Trades API](https://create.roblox.com/docs/cloud/reference/features/trades)

### Copy ownership history

Pass either `{"uaid":"84184655"}` or `{"collectibleInstanceId":"c90b0e8f-45ce-4cb9-9a4c-9f68cce9b3f9"}` to `get_copy_history`. In ChatGPT, ask **@Roxol** to look up a copy by its UAID or collectible instance ID and review its recorded ownership changes for poisoning risk.

Roxol reads RoUtility's public copy endpoints and caches each lookup for two minutes. `copy` includes both copy IDs when available, the Roblox asset ID, the item name, and the serial. `currentOwner` reflects the tracker snapshot when supplied. Each history row has a UTC observation time, available public owner details, and any applicable `hidden` or `previousOwner` marker. A previous-owner marker can share a timestamp with another observation. `hasMore` and `total` describe the returned tracker history. `not_found` means the tracker returned HTTP 404. `unavailable` means Roxol could not read a usable history.

Use the observations to review patterns such as closely spaced ownership changes. The tracker can miss changes or lose visibility into a copy. The timeline alone cannot establish theft or determine that a copy is safe.

### Trade proofs

Pass either `{"id":"439945661"}` or `{"query":"BIA","limit":30}` to `get_trade_proofs`. Text queries use the same ranked lookup as `find_items`. Roxol uses the resolved item's acronym and canonical name to search Discord. It reads up to four pages of 25 result groups per term within a 20-second search budget and keeps posts whose original caption mentions the item. It retries a transient server error once.

For practical overpay analysis, 3–5 recent, independent and comparable trade proofs with consistent overpays are generally sufficient for moderate confidence. Prioritise recency, trade direction and the current Value cycle over sample size. Do not demand unnecessarily large samples or treat limited historical coverage as an analysis blocker when sufficient relevant evidence is available.

Numeric IDs default to assets. Roxol also recognizes bundle IDs from Rolimon's face-to-bundle mapping and the screenshot index. Provide `kind` explicitly to choose the ID type. For a mapped face with a single legacy asset ID, Roxol searches by the legacy item first and can retry with the bundle's name or acronym when the first search returns no matching posts. This works with screenshot reading disabled.

`get_trade_proofs` and `get_trade_context` identify the `value-requests` channel in Rolimon's official Discord as `proofOrigin`. Each post includes a `discordUrl` to cite the original user-reported evidence. In trade context, `proofs[postId].discord` contains the live caption and attachment references. [Rolimon's `value-requests` channel](https://discord.com/channels/415246288779608064/535250426061258753)

Roxol paginates the collected posts by unique post ID and retains the timestamp, caption, and image references. `limit` sets the maximum posts per MCP page, up to 50. `providerCount` counts unique matching Discord posts collected before reviewed and indexed evidence is merged. `discord.searches` reports raw hits and pages fetched for each term. `partial: true` means the search reached its page cap or encountered an upstream failure. `hasMore` refers to additional MCP pages in the collected sample.

To view a screenshot, take an attachment reference from `get_trade_proofs` and pass it as `attachment` to `get_trade_proof_image`. Roxol downloads the screenshot from Discord's CDN and can repeat the bounded search to refresh an expired URL. If the reference is unavailable after a restart, run the item proof lookup again first. Screenshot viewing requires the configured Discord credential for proof search. A vision key is optional and only used for transcription.

To transcribe and index screenshots, call `get_trade_proofs` with `{"query":"SKOTN","limit":3,"readScreenshots":true}`. Set `ROXOL_PROOF_VISION_KEY` to an OpenAI API key in the server's environment or the Git-ignored `tools/mcp/.env`, then restart Roxol. This option sends the selected public trade proof images to the OpenAI Responses API and can incur API usage charges. `ROXOL_PROOF_VISION_MODEL` defaults to `gpt-4.1-mini` and accepts an image-capable model that supports structured outputs. Roxol processes up to 12 distinct attachments on the requested page per call. If a record shows `moreScreenshots`, advance `screenshotOffset` by 12 to select the next group on the same page. [OpenAI image input documentation](https://developers.openai.com/api/docs/guides/images-vision)

- `screenshots[].baskets` keeps both offers in top-to-bottom or left-to-right image order, with each item row, quantity, and any legible serial, displayed price, RAP, or assigned Value. `itemTotals` holds explicitly shown item-only totals where available.
- `priceBasis: "screenshot"` identifies the source of the W/L. `netDisplayedPrice` uses the screenshot's native item prices, while `netRap` and `netValue` use any RAP or assigned Value shown in the screenshot. Each uses the matching item-only totals or the complete sum of item rows, then adds incoming credited Robux and subtracts outgoing gross Robux. A combined total with an unclear fee basis leaves fee-adjusted W/L `null`.
- `screenshots[].afterFees.robux` gives each side's displayed amount, fee basis, gross offered amount, and credited amount where known. Roxol applies Roblox's 30% fee and rounds to the nearest Robux. An explicitly credited amount is used directly. If exactly one gross amount rounds to the displayed credit, Roxol marks that estimate with `offeredInferred: true`. `netRobux` reports each side's net Robux, while `creditedDifference` compares side B's credit with side A's credit. [Roblox trading guide](https://en.help.roblox.com/hc/en-us/articles/203313310-Trading-on-Roblox)
- Completed screenshots with resolved baskets are saved under both sides' item IDs. The index includes legacy face and dynamic-head bundle equivalents from Rolimon's mapping. Aliases point to the same item in the basket. Incomplete reads return available rows and payment details for inspection. Each successful reading retains its attachment reference and image hash. Existing Nevos transcriptions remain indexed. To view the original image for one of those posts, use a current Discord attachment reference from a live lookup.
- The index defaults to `tools/mcp/.proof-screenshots/`, a Git-ignored directory. Set `ROXOL_PROOF_INDEX_DIR` to use a different location. Roxol reloads the saved readings on startup and returns them in later proof and trade-context calls. It reads each indexed attachment once and stores the transcription and evidence references locally.

To verify a deployment, call `get_trade_proofs` for the same ID against localhost, the public tunnel, and ChatGPT. A matching `instanceId` confirms that the results came from the same running Roxol server. It changes when the server restarts. A `discord.httpStatus` of 401 or 403 indicates that Discord refused the search. Check the credential and channel access.

Roxol reads `ROXOL_DISCORD_TOKEN` at startup from the server environment or Git-ignored `tools/mcp/.env`. Use an authorized Discord account that can read the source channel. If you saved the credential for the BIA comparison, restart Roxol with your usual launcher. For a one-time PowerShell session, enter the credential at the hidden prompt.

```powershell
$env:ROXOL_DISCORD_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'Discord credential' -AsSecureString)).Password
npm.cmd start --prefix tools/mcp
```

The optional BIA comparison still uses `ROXOL_PROOFS_TOKEN` for its Nevos baseline. [Provider comparison](../overpay/README.md#compare-discord-and-nevos-proof-coverage)

Set `ROXOL_MCP_PUBLIC_PROOFS` to a JSON file with a `pricedTrades` array to include reviewed proofs for both sides' items alongside live results and indexed screenshots. Roxol continues to serve local matches on request failures, timeouts, empty results, and invalid responses. An unset Discord credential reports `no_discord_token`. HTTP 429 triggers a cooldown using `Retry-After` or 60 seconds if the header is missing or invalid. See `discord` for live search status even when local evidence is available.

Use selected entries from the existing [Roxol proof review export](../overpay/README.md#review-completed-proofs). The MCP loads the file at startup, skips conflicting entries, and returns dated baskets, reported Robux, and evidence references. Discord may require a session to open an evidence link. Restart the server after updating the export or Discord credential.

## Verification

```powershell
npm test --prefix tools/mcp
node --test tools/overpay/*.test.mjs
```

The MCP integration test uses an HTTP client and server with fixture provider responses and a reviewed proof fixture. It verifies Discord caption search and pagination, screenshot extraction, both baskets, fee math, lookups by either side and face equivalents, and reload of both Discord and legacy screenshot index entries. It also covers empty results, invalid responses, network failures, HTTP 403, timeouts, HTTP 429, and missing credentials.

Live checks against Black Iron Antlers covered item search, Rolimon's assigned Value and sale records, two RoUtility trade pages, and Roblox collectible resale history. A live Super Super Happy Face lookup also returned Roblox bundle resale history. Rolimon's item-profile request returned HTTP 403 during the Black Iron Antlers run. The tool reported that daily sales field as unavailable while returning data from the other sources.

The BIA integration fixture supplied 31 unique matching posts across acronym and full-name searches and verified that Roxol returned 30 on page 1 and the remaining post on page 2.

Live local MCP checks against Discord collected 171 matching BIA posts and 190 matching SKOTN posts within the bounded search. Both returned two distinct MCP pages and an original PNG through `get_trade_proof_image`. A trade-context request returned the original Discord links for both items.

Copy history fixtures cover both input types, validation, pagination, cache reuse, hidden and previous-owner records, missing copies, and unavailable data. A live local MCP call for Sapphire Drool UAID `84184655` returned a hidden-owner observation. Two live pages for Goldrow collectible instance `c90b0e8f-45ce-4cb9-9a4c-9f68cce9b3f9` confirmed newest-first pagination. A missing UAID returned `not_found`.

Trade context fixtures cover mixed names, acronyms, and IDs, repeated assets, gross and net Robux, missing prices, ambiguous items, copy resolution and mismatches, limits, and overlapping live and fallback proofs. Live MCP calls returned sales, resale data, and proof posts from Rolimon's Discord for a Silver King of the Night versus Black Iron Antlers, Perfectly Legitimate Business Hat, and 100 Robux example. A copy-to-copy example resolved Sapphire Drool and Goldrow through RoUtility and returned two ownership observations per copy.

The shared extension code also passed the live Edge CDP smoke check for the Marketplace value panel and hover sales preview on Perfectly Legitimate Business Hat at 1,440 × 900.
