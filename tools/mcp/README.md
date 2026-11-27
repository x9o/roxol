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

In a ChatGPT workspace with skill uploads enabled, open **Plugins → Skills → Add → Upload from your computer** and choose the [Roxol Trade Analysis ZIP](../../skills/roxol-trade-analysis.zip). With the Roxol connector available in the chat, attach a Limiteds trade screenshot or describe what you give and receive. The [skill](../../skills/roxol-trade-analysis/SKILL.md) uses `get_trade_context` first and follows up when more evidence could affect the verdict. [Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt)

### Stop or restart

Press **Ctrl+C** in each PowerShell window to stop Roxol and the tunnel. Next time, start at step 2. Each Quick Tunnel restart generates a new hostname. Use it when starting Roxol and update the server URL in ChatGPT.

For a stable URL, use a named tunnel pointing at the same loopback address. For access while your PC is off, run Roxol on an always-on host. A managed host can set `ROXOL_MCP_BIND=0.0.0.0` and `ROXOL_MCP_PUBLIC_HOST` to its public hostname. [Named tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)

## Tools

| Tool | Data |
| --- | --- |
| `find_items` | Find limiteds by ID, name, or acronym in the Rolimon's and RoUtility item feeds. Results include asset or bundle kind. |
| `get_item_stats` | Provider-specific snapshots with RAP, assigned Value, demand, trend, flags, supply where published, and Roblox Best Price. RoUtility's `usdEstimate` and `priceBasis` are provider estimates. |
| `get_trade_context` | Whole-trade evidence with both baskets, RAP and Value totals, recent market activity, shared proof posts, and optional copy history. |
| `get_market_history` | Choose `rolimons_sales` for tracked sales with pre- and post-sale RAP, `rolimons_value_changes` for dated Value changes, or `roblox_resale` for daily prices, volume, and current Roblox resale RAP. |
| `get_trade_observations` | One RoUtility page of 20 records, with both baskets, copy identifiers where published, observed timestamps, RAP, Value and the provider's `inferred` flag. These are ownership-transfer observations with unknown trade completion and side payments. |
| `get_copy_history` | RoUtility's tracked ownership observations for one copy by UAID or collectible instance UUID. Returns timestamps and available public owner identifiers, newest first. |
| `get_trade_proofs` | Live Nevos proof posts, reviewed exports, and indexed screenshot trades by ID, item name, or acronym. Set `readScreenshots` to transcribe new attachments. |
| `get_trade_proof_image` | One original Nevos screenshot, returned as MCP image content for clients that support it. |

Numeric IDs are decimal strings. Item tools default to `asset` and also accept `bundle` where a provider supports it. History and proof pages start at 1, default to 20 records, and accept up to 50 per page. Roblox daily history covers up to 180 returned days. Rolimon's may report more tracked sales than its page includes. Live provider data can shift between page requests. Amounts are in Robux except for fields that explicitly name another currency. A JSON `null` marks an unreported field. Per-source statuses distinguish absent items and unsupported coverage from upstream failures.

The Node process and the extension run independent instances of the same public data layer. The layer deduplicates in-flight calls, caps concurrent upstream requests at four, times requests out, and caches snapshots for up to five minutes. RoUtility trade pages use a two-minute cache. Requests to the three providers omit cookies. The MCP process can start without a browser, Discord session, or Roblox session. It exposes no trading actions.

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

`proofLimit` defaults to 3 per item and accepts 0–10. Items reference posts by ID in the shared `proofs` object. Each post can include the original Nevos post, already indexed `screenshots`, and reviewed evidence. `ownershipLimit` defaults to 0 and accepts up to 20 observations per identified copy. It reuses `get_copy_history` data, combines repeated owner observations, and includes an availability status when a copy lookup fails. Tracker gaps limit what the ownership timeline can establish. Numeric source references index the top-level `sources` array. Each entry includes availability, a source URL, and a check timestamp when known.

An optional `tradeId` records the trade reference and reports lookup availability. The same cookie-authenticated Roblox detail endpoint handles inbound and outbound trade IDs. The Roxol extension uses the signed-in account to orient the offers and reads the UAID or collectible instance ID when Roblox includes it. A signed-out request returned HTTP 401, and a signed-in inbound or outbound trade was unavailable for live verification. The public MCP runs independently of the browser session, so supply the baskets and any known copy IDs for trades you want it to evaluate. [Roblox Trades API](https://create.roblox.com/docs/cloud/reference/features/trades)

### Copy ownership history

Pass either `{"uaid":"84184655"}` or `{"collectibleInstanceId":"c90b0e8f-45ce-4cb9-9a4c-9f68cce9b3f9"}` to `get_copy_history`. In ChatGPT, ask **@Roxol** to look up a copy by its UAID or collectible instance ID and review its recorded ownership changes for poisoning risk.

Roxol reads RoUtility's public copy endpoints and caches each lookup for two minutes. `copy` includes both copy IDs when available, the Roblox asset ID, the item name, and the serial. `currentOwner` reflects the tracker snapshot when supplied. Each history row has a UTC observation time, available public owner details, and any applicable `hidden` or `previousOwner` marker. A previous-owner marker can share a timestamp with another observation. `hasMore` and `total` describe the returned tracker history. `not_found` means the tracker returned HTTP 404. `unavailable` means Roxol could not read a usable history.

Use the observations to review patterns such as closely spaced ownership changes. The tracker can miss changes or lose visibility into a copy. The timeline alone cannot establish theft or determine that a copy is safe.

### Trade proofs

Pass either `{"id":"439945661"}` or `{"query":"SKOTN"}` to `get_trade_proofs`. Text queries use the same ranked lookup as `find_items`. Numeric IDs default to assets. Roxol also recognizes bundle IDs from Rolimon's face-to-bundle mapping and the screenshot index. Provide `kind` explicitly to choose the ID type. For a mapped face with a single legacy asset ID, Roxol checks that ID first and retries Nevos with the bundle ID if the first lookup returns no usable posts. This works with screenshot reading disabled. Each request appends the ID to the proof-search URL and sends an empty POST with a 20-second timeout. Results are paginated by unique post ID and retain Nevos's timestamp, caption, and image references. `providerCount` reports Nevos's original count. The posts contain user-reported evidence.

To view a screenshot, take an attachment URL from `get_trade_proofs` and pass it as `attachment` to `get_trade_proof_image`. Roxol uses its existing Nevos client token to fetch the image and returns it as an MCP image. It requires no Discord bot, Discord session, or vision key. If Nevos returns JSON or the picture cannot be downloaded, the tool reports `unavailable`. After updating and restarting Roxol, refresh the connector's tool list if the new tool is missing.

To transcribe and index screenshots, call `get_trade_proofs` with `{"query":"SKOTN","limit":3,"readScreenshots":true}`. Set `ROXOL_PROOF_VISION_KEY` to an OpenAI API key in the server's environment or the Git-ignored `tools/mcp/.env`, then restart Roxol. This option sends the selected public Nevos images to the OpenAI Responses API and can incur API usage charges. `ROXOL_PROOF_VISION_MODEL` defaults to `gpt-4.1-mini` and accepts an image-capable model that supports structured outputs. Roxol processes up to 12 distinct attachments on the requested page per call. If a record shows `moreScreenshots`, advance `screenshotOffset` by 12 to select the next group on the same page. [OpenAI image input documentation](https://developers.openai.com/api/docs/guides/images-vision)

- `screenshots[].baskets` keeps both offers in top-to-bottom or left-to-right image order, with each item row, quantity, and any legible serial, displayed price, RAP, or assigned Value. `itemTotals` holds explicitly shown item-only totals where available.
- `priceBasis: "screenshot"` identifies the source of the W/L. `netDisplayedPrice` uses the screenshot's native item prices, while `netRap` and `netValue` use any RAP or assigned Value shown in the screenshot. Each uses the matching item-only totals or the complete sum of item rows, then adds incoming credited Robux and subtracts outgoing gross Robux. A combined total with an unclear fee basis leaves fee-adjusted W/L `null`.
- `screenshots[].afterFees.robux` gives each side's displayed amount, fee basis, gross offered amount, and credited amount where known. Roxol applies Roblox's 30% fee and rounds to the nearest Robux. An explicitly credited amount is used directly. If exactly one gross amount rounds to the displayed credit, Roxol marks that estimate with `offeredInferred: true`. `netRobux` reports each side's net Robux, while `creditedDifference` compares side B's credit with side A's credit. [Roblox trading guide](https://en.help.roblox.com/hc/en-us/articles/203313310-Trading-on-Roblox)
- Completed screenshots with resolved baskets are saved under both sides' item IDs. The index includes legacy face and dynamic-head bundle equivalents from Rolimon's mapping. Aliases point to the same item in the basket. Incomplete reads return available rows and payment details for inspection. Each successful reading retains its Nevos attachment URL and image hash.
- The index defaults to `tools/mcp/.proof-screenshots/`, a Git-ignored directory. Set `ROXOL_PROOF_INDEX_DIR` to use a different location. Roxol reloads the saved readings on startup and returns them in later proof and trade-context calls. It reads each indexed attachment once and stores the transcription and evidence references locally.

To verify a deployment, call `get_trade_proofs` for the same ID against localhost, the public tunnel, and ChatGPT. A matching `instanceId` confirms that the results came from the same running Roxol server. It changes when the server restarts. When Roxol returns HTTP 200 with `nevos.httpStatus: 403`, the proof request reached Roxol and Nevos refused the upstream call. If the Nevos response contains its known proxy or datacenter rejection, Roxol includes that sentence in `nevos.message`. Roxol exposes only that allowlisted message from upstream error bodies.

Roxol reads the proof request settings at startup. Set `ROXOL_PROOFS_TOKEN` to a valid Nevos client token in the server's environment or `tools/mcp/.env`. For a PowerShell session, you can enter the token without echoing it or putting it in command history.

```powershell
$env:ROXOL_PROOFS_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'Nevos client token' -AsSecureString)).Password
npm.cmd start --prefix tools/mcp
```

The endpoint and other headers have built-in defaults for unset or empty values. An unset or blank token makes Roxol use the reviewed export, when configured, and report `no_nevos_client_token` for the live source.

| Environment variable | Request setting |
| --- | --- |
| `ROXOL_PROOFS_URL` | Base URL, default `https://nevos-extension.com/api/proofs/search` |
| `ROXOL_PROOFS_TOKEN` | `X-Nte-Client`, required for live proofs |
| `ROXOL_PROOFS_ORIGIN` | `Origin` |
| `ROXOL_PROOFS_USER_AGENT` | `User-Agent` |
| `ROXOL_PROOFS_ACCEPT` | `Accept`, default `application/json` |
| `ROXOL_PROOFS_CONTENT_TYPE` | `Content-Type`, default `application/json` |
| `ROXOL_PROOFS_FROM_EXTENSION` | `From-Extension`, default `1` |
| `ROXOL_PROOFS_SEC_FETCH_DEST` | `Sec-Fetch-Dest`, default `empty` |
| `ROXOL_PROOFS_SEC_FETCH_MODE` | Fetch mode and `Sec-Fetch-Mode`, default `cors` |
| `ROXOL_PROOFS_SEC_FETCH_SITE` | `Sec-Fetch-Site`, default `none` |

Set `ROXOL_MCP_PUBLIC_PROOFS` to a JSON file with a `pricedTrades` array to include reviewed proofs for both sides' items alongside live results and indexed screenshots. Roxol continues to serve local matches on request failures, timeouts, empty results, and invalid response bodies, including the `edge-cache` response. HTTP 429 triggers a cooldown using `Retry-After` or 60 seconds if the header is missing or invalid. The response includes the Nevos status when live results are unavailable. If there are no local matches, a configured export returns an empty page and a lookup without an export reports `unavailable`.

Use selected entries from the existing [Roxol proof review export](../overpay/README.md#review-completed-proofs). The MCP loads the file at startup, skips conflicting entries, and returns dated baskets, reported Robux, and evidence references. Discord may require a session to open an evidence link. Restart the server after updating the export or client token.

## Verification

```powershell
npm test --prefix tools/mcp
node --test tools/overpay/*.test.mjs
```

The MCP integration test uses an HTTP client and server with fixture provider responses and a reviewed proof fixture. It verifies screenshot extraction, both baskets, fee math, lookups by either side and face equivalents, index reload, acronym resolution, and proof pagination. It also covers empty results, an `edge-cache` response, a network failure, HTTP 403, a timeout, and HTTP 429. Unit tests check request overrides, missing credentials, and amounts with different fee bases. The initial live Node POST for asset ID `439945661` returned HTTP 200 with 12 SKOTN proof records. Later direct and MCP requests returned HTTP 403 with a provider error about proxy or datacenter networks.

Live checks against Black Iron Antlers covered item search, Rolimon's assigned Value and sale records, two RoUtility trade pages, and Roblox collectible resale history. A live Super Super Happy Face lookup also returned Roblox bundle resale history. Rolimon's item-profile request returned HTTP 403 during the Black Iron Antlers run. The tool reported that daily sales field as unavailable while returning data from the other sources.

Copy history fixtures cover both input types, validation, pagination, cache reuse, hidden and previous-owner records, missing copies, and unavailable data. A live local MCP call for Sapphire Drool UAID `84184655` returned a hidden-owner observation. Two live pages for Goldrow collectible instance `c90b0e8f-45ce-4cb9-9a4c-9f68cce9b3f9` confirmed newest-first pagination. A missing UAID returned `not_found`.

Trade context fixtures cover mixed names, acronyms, and IDs, repeated assets, gross and net Robux, missing prices, ambiguous items, copy resolution and mismatches, limits, and overlapping live and fallback proofs. Live MCP calls returned sales, resale data, and Nevos posts for a Silver King of the Night versus Black Iron Antlers, Perfectly Legitimate Business Hat, and 100 Robux example. A copy-to-copy example resolved Sapphire Drool and Goldrow through RoUtility and returned two ownership observations per copy.

The shared extension code also passed the live Edge CDP smoke check for the Marketplace value panel and hover sales preview on Perfectly Legitimate Business Hat at 1,440 × 900.
