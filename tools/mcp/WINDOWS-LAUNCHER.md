# Start Roxol on Windows

Double-click [start-roxol.bat](../../start-roxol.bat) in the Roxol folder. It starts Roxol and the configured tunnel in one window, prints the URL ending in `/mcp`, and checks that the public URL reaches Roxol.

## Set up a fixed URL with ngrok

1. Install ngrok for Windows and use `ngrok config add-authtoken` to save your account's authtoken in ngrok's local config. Find your assigned hostname on the ngrok dashboard. [ngrok Windows setup](https://ngrok.com/download/windows)
2. In the Git-ignored `tools/mcp/.env`, set `ROXOL_NGROK_HOST` to the assigned hostname, such as `your-name.ngrok-free.dev`. Use the hostname alone. The launcher defaults to port `8788` and accepts `PORT` in the same file for ngrok if you need a different local port.
3. Double-click `start-roxol.bat` and wait for **Public MCP check passed**. Configure ChatGPT with the printed HTTPS URL, including `/mcp`, and choose **No authentication**. The ngrok authtoken stays in ngrok's local config.

The same hostname works across launcher restarts and PC reboots. If `ROXOL_NGROK_HOST` is unset, the launcher uses a Cloudflare Quick Tunnel.

## After turning on your PC

1. Connect Surfshark if you use it for ChatGPT. Keep your existing Bypasser rule for `node.exe` so Roxol can reach Nevos over your regular connection.
2. Double-click `start-roxol.bat`. Wait for **ChatGPT MCP URL**. Keep the launcher window open and the PC awake.
3. In **ChatGPT → Plugins → Roxol**, use the printed URL as the server URL. Include the `/mcp` at the end. If you haven’t connected Roxol before, use **Add custom MCP server**. [Connection settings](README.md#4-connect-in-chatgpt)
4. In a chat, select **@Roxol** and ask it to get trade proofs for item ID `439945661`.

The launcher uses port `8788` by default and loads the token from the Git-ignored `tools/mcp/.env` through the Roxol server. If you already set up that file, you can start without entering the token again. [Token setup](README.md#trade-proofs)

## Stop or restart

Press **Ctrl+C** in the launcher window to stop Roxol and its tunnel. If Windows asks whether to terminate the batch job, type **Y**. Double-click the launcher again to restart both.

Each new Quick Tunnel gets a new URL. Paste the new address into ChatGPT after a reboot or tunnel restart. A named Cloudflare Tunnel with a hostname on your domain can keep the URL stable. [Cloudflare tunnel documentation](https://developers.cloudflare.com/tunnel/concepts/)

## If the launcher stops with an error

| Message or symptom | What to check |
| --- | --- |
| Port `8788` is already in use | Roxol may already be running. Close the older launcher or stop the manually started Roxol server before launching a new one. |
| Missing Node, MCP dependencies, or `cloudflared.exe` | Follow [the one-time installation steps](README.md#1-install-once). The launcher finds Cloudflare on your PATH, in `%LOCALAPPDATA%\Roxol\bin`, or in the existing `%TEMP%\roxol-cloudflared` folder. |
| Missing `ngrok.exe` or an ngrok startup error | Confirm `ngrok version` works in a new terminal, check the saved authtoken, and confirm that `ROXOL_NGROK_HOST` matches the hostname assigned to your account. |
| ChatGPT can’t connect | Check that the launcher is still open and ChatGPT uses the URL it printed on this run. |
| The proof result shows `nevos.httpStatus: 403` | Roxol received the request. If `nevos.message` reports a proxy or datacenter network, check the full path of the running `node.exe` against Surfshark Bypasser and check the outgoing route. Compare `instanceId` across localhost, the public URL, and ChatGPT to identify the running server. |
