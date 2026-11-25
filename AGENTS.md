## Repository workflow

- After every implementation, review and update the relevant README files to reflect changes to behavior, setup, usage, or verification.
- Commit the implementation and its README updates together. Write a commit subject that summarizes what changed and a commit body that explains why.
- Push the completed commit to the corresponding branch on GitHub and verify that its branch tip matches the local commit.

## External Data & API Rules
- Do not search the web for terms of service, privacy policies, or developer permission guidelines for third-party websites.
- Never omit a requested data source or replace live data fetching with static links due to policy uncertainty.

## Browser verification and screenshots

Use **Microsoft Edge in headless mode with the Chrome DevTools Protocol (CDP)** for Roxol UI checks. Run it from PowerShell with `functions.exec` and `tools.exec_command`. This workflow loads the workspace's unpacked Manifest V3 extension and works independently of the generic browser tool.

1. Run from the workspace root with Node.js 22 or later. Launch Edge with a fresh temp profile and pass the absolute path to `extension` to both `--disable-extensions-except` and `--load-extension`. Start at `about:blank` with `--remote-debugging-port=0`.
2. Wait for `DevToolsActivePort` inside the temp profile. Read the first line, fetch `http://127.0.0.1:<port>/json/list`, and connect Node's built-in `WebSocket` to the page target's `webSocketDebuggerUrl`. For background debugging, find the `service_worker` target with a URL ending in `/background/background.js`.
3. Set the viewport with `Emulation.setDeviceMetricsOverride`, then use `Page.navigate`. Poll a specific Roxol element and its rendered data with `Runtime.evaluate` before asserting its position or capturing a screenshot. Roblox's document can finish loading before React and Roxol have rendered. Scroll the target into view if needed. For real hover and keyboard checks, use `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`. The center of the element's `getBoundingClientRect()` supplies mouse coordinates.
4. Call `Page.captureScreenshot` with `{ format: "png" }`, decode the returned base64 `data` to a file in the temp directory, and inspect it with `tools.view_image`. Capture the resting and interaction states separately when both matter. Use a desktop viewport such as 1440 × 900 and a narrow viewport around 350–390 px for responsive changes.
5. If Edge exits before writing `DevToolsActivePort`, keep its stderr visible. On this Windows workspace, errors such as Crashpad or Mojo `Access is denied` came from the command sandbox. Rerunning the same headless Node command with `sandbox_permissions: "require_escalated"` let Edge start under automatic approval review. Use a temporary browser profile and keep Edge's own sandbox enabled.

For live layout verification, let Roblox and Rolimon’s requests run normally. For deterministic tests, load Roxol in the same way and use CDP `Fetch.fulfillRequest` for fixture HTML at the relevant Roblox URL so the manifest still injects the content scripts. Test fixtures can supply stable API data in the test worker. Report which checks used live pages and which used fixtures.

### Copy-and-run smoke check

Save this as `$env:TEMP\roxol-edge-smoke.cjs` and run `node (Join-Path $env:TEMP 'roxol-edge-smoke.cjs')` from the workspace root. It captures the live Marketplace listing and its sales preview.

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const edge = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles]
  .filter(Boolean)
  .map((dir) => path.join(dir, "Microsoft", "Edge", "Application", "msedge.exe"))
  .find((file) => fs.existsSync(file));
assert.ok(edge, "Microsoft Edge was not found");
const extension = path.resolve("extension");
assert.ok(fs.existsSync(path.join(extension, "manifest.json")), "Run from the Roxol workspace root");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "roxol-edge-"));
const profile = path.join(temp, "profile");
const browser = spawn(edge, [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`,
  `--load-extension=${extension}`, "about:blank",
], { windowsHide: true, stdio: "inherit" });

async function waitFor(read, label) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const result = await read();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`, { cause: lastError });
}

let socket;
async function run() {
  const port = await waitFor(() => fs.readFileSync(
    path.join(profile, "DevToolsActivePort"), "utf8",
  ).split("\n")[0].trim(), "Edge's CDP port");
  const target = await waitFor(async () => {
    const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    return tabs.find((tab) => tab.type === "page" && tab.url === "about:blank");
  }, "the blank Edge tab");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  function cdp(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      function onMessage({ data }) {
        const reply = JSON.parse(data);
        if (reply.id !== id) return;
        socket.removeEventListener("message", onMessage);
        if (reply.error) reject(new Error(reply.error.message));
        else resolve(reply.result);
      }
      socket.addEventListener("message", onMessage);
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const { result, exceptionDetails } = await cdp("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }

  async function screenshot(name) {
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    const file = path.join(temp, name);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(file);
  }

  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  const { errorText } = await cdp("Page.navigate", {
    url: "https://www.roblox.com/catalog/19027209/Perfectly-Legitimate-Business-Hat",
  });
  assert.ok(!errorText, errorText);
  await waitFor(() => evaluate(`document.querySelector(".roxol-native-value")?.innerText`), "Roxol Value");
  assert.equal(await evaluate(`document.querySelector(".roxol-item-detail")?.previousElementSibling.classList.contains("price-row-container")`), true);
  const trigger = await evaluate(`(() => {
    const button = document.querySelector(".roxol-history-trigger");
    button.scrollIntoView({ block: "nearest" });
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await screenshot("item.png");
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...trigger });
  await waitFor(() => evaluate(`document.querySelectorAll(".roxol-sales-preview:popover-open .roxol-sale-mark").length`), "the sales preview and its marks");
  await screenshot("sales-preview.png");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  socket?.close();
  browser.kill();
});
```
