# Start Roxol on Windows

Double-click [start-roxol.bat](../../start-roxol.bat) in the Roxol folder. It starts Cloudflare and Roxol in one window, prints the URL ending in `/mcp`, and checks whether it can reach the new public URL.

## After turning on your PC

1. Connect Surfshark if you use it for ChatGPT. Keep your existing Bypasser rule for `node.exe` so Roxol can reach Nevos over your regular connection.
2. Double-click `start-roxol.bat`. Wait for **ChatGPT MCP URL**. Keep the launcher window open and the PC awake.
3. In **ChatGPT → Plugins → Roxol**, use the printed URL as the server URL. Include the `/mcp` at the end. If you haven’t connected Roxol before, use **Add custom MCP server**. [Connection settings](README.md#4-connect-in-chatgpt)
4. In a chat, select **@Roxol** and ask it to get trade proofs for item ID `439945661`.

The launcher uses port `8788` by default and loads the token from the Git-ignored `tools/mcp/.env` through the Roxol server. If you already set up that file, you can start without entering the token again. [Token setup](README.md#trade-proofs)

## Stop or restart

Press **Ctrl+C** in the launcher window to stop Roxol and Cloudflare. If Windows asks whether to terminate the batch job, type **Y**.

Each new Quick Tunnel gets a new URL. Paste the new address into ChatGPT after a reboot or tunnel restart. A named Cloudflare Tunnel with a hostname on your domain can keep the URL stable. [Cloudflare tunnel documentation](https://developers.cloudflare.com/tunnel/concepts/)

## If the launcher stops with an error

| Message or symptom | What to check |
| --- | --- |
| Port `8788` is already in use | Roxol may already be running. Close the older launcher or stop the manually started Roxol server before launching a new one. |
| Missing Node, MCP dependencies, or `cloudflared.exe` | Follow [the one-time installation steps](README.md#1-install-once). The launcher finds Cloudflare on your PATH, in `%LOCALAPPDATA%\Roxol\bin`, or in the existing `%TEMP%\roxol-cloudflared` folder. |
| ChatGPT can’t connect | Check that the launcher is still open and ChatGPT uses the URL it printed on this run. |
| Roxol connects, but the Nevos source returns HTTP 403 | The MCP connection is working. Check the Surfshark Bypasser rule for the Node executable Roxol uses. |
