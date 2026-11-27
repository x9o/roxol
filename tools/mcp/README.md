# Roxol market data MCP

Roxol serves live public limited-item data through a stateless Streamable HTTP endpoint at `/mcp`. It runs in one Node.js process with in-memory caches. The tools return JSON with source URLs, observation timestamps where available, provider status, and pagination. ChatGPT supplies the analysis.

## Windows quick start

You need Node.js 22 or newer, a local copy of Roxol, and access to **Add custom MCP server** in ChatGPT. This setup uses two PowerShell windows. Your PC must stay on, awake, and online while you use Roxol. You can lock the screen.

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

### 4. Connect in ChatGPT

Open **Plugins → Add → Add custom MCP server** in ChatGPT. [OpenAI connection settings](https://developers.openai.com/api/docs/guides/custom-mcp-server)

| Field | Value |
| --- | --- |
| Name | Roxol |
| Description | Look up Roblox limited item stats, resale history, and public trade observations from Rolimon's, RoUtility, and Roblox. |
| Connection | **Server URL** |
| Server URL | Your tunnel's HTTPS URL followed by `/mcp`, such as `https://your-tunnel.trycloudflare.com/mcp` |
| Authentication | **No authentication** |

Create and install the plugin. Check that ChatGPT lists five tools, then select **@Roxol** in a chat and ask for the current stats for Black Iron Antlers. If discovery fails, check that both PowerShell windows are running and that the plugin URL uses the current hostname and ends in `/mcp`.

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
| `get_trade_proofs` | Item-specific screenshot evidence from the configured reviewed public export, with dated baskets, reported Robux and a source post link. |

IDs are decimal strings. Item tools default to `asset` and also accept `bundle` where a provider supports it. History and proof pages start at 1, default to 20 records, and accept up to 50 per page. Roblox daily history covers up to 180 returned days. Rolimon's may report more tracked sales than its page includes. Live provider data can shift between page requests. Amounts are in Robux except for fields that explicitly name another currency. A JSON `null` marks an unreported field. Per-source statuses distinguish absent items and unsupported coverage from upstream failures.

The Node process and the extension run independent instances of the same public data layer. The layer deduplicates in-flight calls, caps concurrent upstream requests at four, times requests out, and caches snapshots for up to five minutes. RoUtility trade pages use a two-minute cache. Requests to the three providers omit cookies. The MCP process can start without a browser, Discord session, or Roblox session. It exposes no trading actions.

### Reviewed public proofs

Rolimon's describes screenshots in its Discord value-request channel and in user-created albums. Roxol has no verified anonymous live screenshot-proof feed from the requested providers. RoUtility's live trade tracker supplies a separate observations tool. [Rolimon's valuation process](https://www.rolimons.com/article/rolimons-value-changing-system-how-does-it-work)

Set `ROXOL_MCP_PUBLIC_PROOFS` to the path of a JSON file with a `pricedTrades` array containing only reviewed proofs you intend to serve publicly. Use selected entries from the existing [Roxol proof review export](../overpay/README.md#review-completed-proofs). The MCP loads the file at startup, skips conflicting entries, and returns the permitted evidence fields, excluding participant names, message text, and local attachment paths. Discord may require a session to open an evidence link. Restart the server after updating the export. With no configured export, the tool reports `unavailable`. A configured export with no matches returns an empty page.

## Verification

```powershell
npm test --prefix tools/mcp
node --test tools/overpay/*.test.mjs
```

The MCP integration test uses an actual HTTP client and server with fixture provider responses and a reviewed proof fixture. Live checks against Black Iron Antlers covered item search, Rolimon's assigned Value and sale records, two RoUtility trade pages, and Roblox collectible resale history. A live Super Super Happy Face lookup also returned Roblox bundle resale history. Rolimon's item-profile request returned HTTP 403 during the Black Iron Antlers run. The tool reported that daily sales field as unavailable while returning data from the other sources.

The shared extension code also passed the live Edge CDP smoke check for the Marketplace value panel and hover sales preview on Perfectly Legitimate Business Hat at 1,440 × 900.
