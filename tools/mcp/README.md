# Roxol market data MCP

Roxol serves live public limited-item data through a stateless Streamable HTTP endpoint at `/mcp`. It runs in one Node.js process with in-memory caches. The tools return JSON with source URLs, observation timestamps where available, provider status, and pagination. ChatGPT supplies the analysis.

## Run locally

Use Node.js 22 or later and run these commands from the repository root.

```powershell
npm ci --prefix tools/mcp
npm start --prefix tools/mcp
```

The default endpoint is `http://127.0.0.1:8787/mcp`. Set `PORT` to choose another port. Use the loopback binding for tunnels and reverse proxies on the same machine. A managed host can set `ROXOL_MCP_BIND=0.0.0.0` and `ROXOL_MCP_PUBLIC_HOST` to its external hostname, without a scheme or path.

## Connect in ChatGPT

Use ChatGPT on the web and open **Plugins → Add → Add custom MCP server**. OpenAI documents read-only custom MCP access for Pro and eligible workspaces. A Plus account that already shows **Add custom MCP server** can attempt the connection there. Tool discovery after creation is the account-specific check. [OpenAI connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)

The simplest temporary setup is a local Node process and a Cloudflare Quick Tunnel. Start the tunnel in another terminal with `cloudflared tunnel --url http://127.0.0.1:8787`. It prints a temporary HTTPS URL. Set `$env:ROXOL_MCP_PUBLIC_HOST = '<hostname from the tunnel URL>'` in the Node terminal, then start or restart the server. Keep both processes running. For a stable URL, use a named Cloudflare Tunnel pointing at the same loopback address and set the same variable to its public hostname. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) · [Named tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)

In the ChatGPT dialog, enter **Roxol**, choose **Server URL**, and paste the HTTPS URL with `/mcp` appended. Set **Authentication** to **No authentication**, create the plugin, and verify that five tools appear. Install the plugin, then select **@Roxol** in a chat. Anyone with access to the HTTPS endpoint can query the data it serves. [OpenAI connection settings](https://developers.openai.com/api/docs/guides/custom-mcp-server)

Try asking “Use Roxol to look up Black Iron Antlers, get the latest public statistics, and fetch the first five assigned Value changes.”

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
