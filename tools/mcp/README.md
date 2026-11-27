# Roxol market data MCP

Roxol serves live public limited-item data through a stateless Streamable HTTP endpoint at `/mcp`. It runs in one Node.js process with in-memory caches. The tools return JSON with source URLs, observation timestamps where available, provider status, and pagination. ChatGPT supplies the analysis.

## Windows quick start

You need Node.js 22 or newer, a local copy of Roxol, and access to **Add custom MCP server** in ChatGPT. After installing the dependencies, use the [double-click Windows launcher](WINDOWS-LAUNCHER.md) to start Roxol and Cloudflare together. The manual setup below uses two PowerShell windows. Your PC must stay on, awake, and online while you use Roxol. You can lock the screen.

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

Create and install the plugin. Check that ChatGPT lists six tools, then select **@Roxol** in a chat and ask for the current stats for Black Iron Antlers. If discovery fails, check that both PowerShell windows are running and that the plugin URL uses the current hostname and ends in `/mcp`.

### Stop or restart

Press **Ctrl+C** in each PowerShell window to stop Roxol and the tunnel. Next time, start at step 2. Each Quick Tunnel restart generates a new hostname. Use it when starting Roxol and update the server URL in ChatGPT.

For a stable URL, use a named tunnel pointing at the same loopback address. For access while your PC is off, run Roxol on an always-on host. A managed host can set `ROXOL_MCP_BIND=0.0.0.0` and `ROXOL_MCP_PUBLIC_HOST` to its public hostname. [Named tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)

## Tools

| Tool | Data |
| --- | --- |
| `find_items` | Find limiteds by ID, name, or acronym in the Rolimon's and RoUtility item feeds. Results include asset or bundle kind. |
| `get_item_stats` | Provider-specific snapshots with RAP, assigned Value, demand, trend, flags, supply where published, and Roblox Best Price. RoUtility's `usdEstimate` and `priceBasis` are provider estimates. |
| `get_market_history` | Choose `rolimons_sales` for tracked sales with pre- and post-sale RAP, `rolimons_value_changes` for dated Value changes, or `roblox_resale` for daily prices, volume, and current Roblox resale RAP. |
| `get_trade_observations` | One RoUtility page of 20 records, with both baskets, copy identifiers where published, observed timestamps, RAP, Value and the provider's `inferred` flag. These are ownership-transfer observations with unknown trade completion and side payments. |
| `get_copy_history` | RoUtility's tracked ownership observations for one copy by UAID or collectible instance UUID. Returns timestamps and available public owner identifiers, newest first. |
| `get_trade_proofs` | Live Nevos proof posts by ID, item name, or acronym, with reviewed screenshot evidence as a fallback. Bundle lookups use the reviewed export. |

Numeric IDs are decimal strings. Item tools default to `asset` and also accept `bundle` where a provider supports it. History and proof pages start at 1, default to 20 records, and accept up to 50 per page. Roblox daily history covers up to 180 returned days. Rolimon's may report more tracked sales than its page includes. Live provider data can shift between page requests. Amounts are in Robux except for fields that explicitly name another currency. A JSON `null` marks an unreported field. Per-source statuses distinguish absent items and unsupported coverage from upstream failures.

The Node process and the extension run independent instances of the same public data layer. The layer deduplicates in-flight calls, caps concurrent upstream requests at four, times requests out, and caches snapshots for up to five minutes. RoUtility trade pages use a two-minute cache. Requests to the three providers omit cookies. The MCP process can start without a browser, Discord session, or Roblox session. It exposes no trading actions.

### Copy ownership history

Pass either `{"uaid":"84184655"}` or `{"collectibleInstanceId":"c90b0e8f-45ce-4cb9-9a4c-9f68cce9b3f9"}` to `get_copy_history`. In ChatGPT, ask **@Roxol** to look up a copy by its UAID or collectible instance ID and review its recorded ownership changes for poisoning risk.

Roxol reads RoUtility's public copy endpoints and caches each lookup for two minutes. `copy` includes both copy IDs when available, the Roblox asset ID, the item name, and the serial. `currentOwner` reflects the tracker snapshot when supplied. Each history row has a UTC observation time, available public owner details, and any applicable `hidden` or `previousOwner` marker. A previous-owner marker can share a timestamp with another observation. `hasMore` and `total` describe the returned tracker history. `not_found` means the tracker returned HTTP 404. `unavailable` means Roxol could not read a usable history.

Use the observations to review patterns such as closely spaced ownership changes. The tracker can miss changes or lose visibility into a copy. The timeline alone cannot establish theft or determine that a copy is safe.

### Trade proofs

Pass either `{"id":"439945661"}` or `{"query":"SKOTN"}` to `get_trade_proofs`. Text queries use the same ranked lookup as `find_items`. Provide `kind` to restrict a query to assets or bundles. The live lookup appends the resolved asset ID to the proof-search URL and sends a POST with an empty body and a 20-second timeout. The response includes the post ID, posting timestamp, text, and Nevos image references when available. Live and reviewed results keep the most recent matching record for each post ID before pagination. `total` and `hasMore` reflect the unique records. `providerCount` reports Nevos's original count. The posts contain user-reported evidence.

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

Set `ROXOL_MCP_PUBLIC_PROOFS` to a JSON file with a `pricedTrades` array to serve reviewed proofs for bundles or when Nevos is unavailable. Roxol falls back on request failures, timeouts, empty results, and invalid response bodies, including the `edge-cache` response. HTTP 429 triggers a cooldown using `Retry-After` or 60 seconds if the header is missing or invalid. The fallback includes the Nevos status. If no export is configured, it reports `unavailable`. A configured export with no matches returns an empty page.

Use selected entries from the existing [Roxol proof review export](../overpay/README.md#review-completed-proofs). The MCP loads the file at startup, skips conflicting entries, and returns dated baskets, reported Robux, and evidence references. Discord may require a session to open an evidence link. Restart the server after updating the export or client token.

## Verification

```powershell
npm test --prefix tools/mcp
node --test tools/overpay/*.test.mjs
```

The MCP integration test uses an actual HTTP client and server with fixture provider responses and a reviewed proof fixture. It verifies acronym resolution, the Nevos POST, proof pagination, and fallback for empty results, an `edge-cache` response, a network failure, HTTP 403, a timeout, and HTTP 429. Unit tests check request overrides and fallback when the token is unset. The initial live Node POST for asset ID `439945661` returned HTTP 200 with 12 SKOTN proof records. Later direct and MCP requests returned HTTP 403 with a provider error about proxy or datacenter networks.

Live checks against Black Iron Antlers covered item search, Rolimon's assigned Value and sale records, two RoUtility trade pages, and Roblox collectible resale history. A live Super Super Happy Face lookup also returned Roblox bundle resale history. Rolimon's item-profile request returned HTTP 403 during the Black Iron Antlers run. The tool reported that daily sales field as unavailable while returning data from the other sources.

Copy history fixtures cover both input types, validation, pagination, cache reuse, hidden and previous-owner records, missing copies, and unavailable data. A live local MCP call for Sapphire Drool UAID `84184655` returned a hidden-owner observation. Two live pages for Goldrow collectible instance `c90b0e8f-45ce-4cb9-9a4c-9f68cce9b3f9` confirmed newest-first pagination. A missing UAID returned `not_found`.

The shared extension code also passed the live Edge CDP smoke check for the Marketplace value panel and hover sales preview on Perfectly Legitimate Business Hat at 1,440 × 900.
