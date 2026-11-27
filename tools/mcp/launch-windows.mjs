import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 8788);
const shutdown = new AbortController();
const { signal } = shutdown;
const processes = [];
let stopping = false;
let tunnelLog = "";

function stop() {
  stopping = true;
  shutdown.abort();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

function findCloudflared() {
  const directories = [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    path.join(process.env.LOCALAPPDATA ?? "", "Roxol", "bin"),
    path.join(process.env.TEMP ?? "", "roxol-cloudflared"),
  ];
  return directories.map((directory) => path.join(directory.replace(/^"|"$/g, ""), "cloudflared.exe"))
    .find((file) => existsSync(file));
}

function start(name, executable, args, options) {
  const child = spawn(executable, args, { cwd: import.meta.dirname, windowsHide: true, ...options });
  processes.push(child);
  child.once("error", (error) => shutdown.abort(new Error(`${name}: ${error.message}`)));
  child.once("exit", (code, childSignal) => {
    shutdown.abort(new Error(`${name} exited (${childSignal ?? code}).`));
  });
  return child;
}

async function waitFor(read, label, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const value = await read();
    if (value) return value;
    await delay(250, undefined, { signal });
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function initialize(url) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "roxol-launcher", version: "1" } },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]),
    });
    if (response.ok) return (await response.json()).result?.serverInfo?.name === "roxol-market-data";
    await response.body?.cancel();
  } catch {
    // The tunnel can take a few seconds to route to the server.
  }
  return false;
}

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Set PORT to a number from 1 to 65535.");
  if (!existsSync(path.join(import.meta.dirname, "node_modules", "@modelcontextprotocol", "sdk"))) {
    throw new Error("Install the MCP dependencies with npm.cmd ci --prefix tools/mcp.");
  }
  const cloudflared = findCloudflared();
  if (!cloudflared) throw new Error("cloudflared.exe was not found. See the Windows launcher guide.");

  const portCheck = createServer().listen(port, host);
  try {
    await once(portCheck, "listening");
  } catch (error) {
    if (error.code === "EADDRINUSE") throw new Error(`Port ${port} is already in use. Close the existing Roxol server first.`);
    throw error;
  }
  await new Promise((resolve) => portCheck.close(resolve));

  console.log("Starting the Cloudflare Quick Tunnel...");
  const tunnel = start("Cloudflare", cloudflared, ["tunnel", "--url", `http://${host}:${port}`, "--protocol", "http2"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tunnelAddress = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;
  for (const stream of [tunnel.stdout, tunnel.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      tunnelLog = (tunnelLog + chunk).slice(-6000);
    });
  }
  const publicUrl = await waitFor(() => tunnelLog.match(tunnelAddress)?.[0], "a Cloudflare URL", 30_000);

  start("Roxol", process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(port), ROXOL_MCP_BIND: host, ROXOL_MCP_PUBLIC_HOST: new URL(publicUrl).hostname },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const mcpUrl = `${publicUrl}/mcp`;
  await waitFor(() => initialize(`http://${host}:${port}/mcp`), "Roxol to answer locally", 10_000);
  await waitFor(() => tunnelLog.includes("Registered tunnel connection"), "Cloudflare to connect", 30_000);
  console.log(`\nChatGPT MCP URL\n${mcpUrl}\n\nKeep this window open. Press Ctrl+C to stop Roxol and Cloudflare.`);
  try {
    await waitFor(() => initialize(mcpUrl), "Roxol to answer through Cloudflare", 10_000);
    console.log("Public MCP check passed.");
  } catch {
    signal.throwIfAborted();
    console.log("Roxol is ready locally. The public URL may take longer to become reachable.");
  }
  if (!signal.aborted) await once(signal, "abort");
  signal.throwIfAborted();
} catch (error) {
  if (!stopping) {
    console.error((signal.reason ?? error).message);
    if (tunnelLog) console.error(tunnelLog.trim());
    process.exitCode = 1;
  }
} finally {
  for (const child of processes.reverse()) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}
