import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function waitFor(read, label, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      if (!/Cannot find default execution context|Execution context was destroyed/.test(error.message)) throw error;
    }
    await delay(200);
  }
  throw new Error("Timed out waiting for " + label);
}

export function launchEdge(profile, args, interactive = false) {
  const edge = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles]
    .filter(Boolean).map((root) => path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"))
    .find(existsSync);
  if (!edge) throw new Error("Microsoft Edge was not found.");
  return spawn(edge, [
    "--no-first-run", "--no-default-browser-check", "--disable-background-mode",
    "--user-data-dir=" + profile, ...args,
  ], interactive ? { stdio: "ignore", detached: true } : { stdio: "inherit", windowsHide: true });
}

export async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) request.reject(new Error("Edge disconnected."));
    pending.clear();
  });
  function send(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(fn, ...args) {
    const response = await send("Runtime.evaluate", {
      expression: "(" + fn.toString() + ")(..." + JSON.stringify(args) + ")",
      returnByValue: true, awaitPromise: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  }
  return { send, evaluate, close: () => socket.close() };
}

export async function browserTargets(profile, browser) {
  await mkdir(profile, { recursive: true });
  const port = await waitFor(async () => {
    if (browser.exitCode !== null) throw new Error("Edge exited before opening CDP. Close any window using the dedicated profile.");
    const data = await readFile(path.join(profile, "DevToolsActivePort"), "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return Number(data?.split("\n")[0]);
  }, "Edge CDP");
  return () => fetch("http://127.0.0.1:" + port + "/json/list", {
    signal: AbortSignal.timeout(3000),
  }).then((response) => response.json());
}
