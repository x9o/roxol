const form = document.querySelector("form");
const controls = [...form.querySelectorAll("select, input")];
const groups = form.querySelectorAll("[data-feature]");
const settingsStatus = document.querySelector("#settings-status");
const pageStatus = document.querySelector("#page-status");
let preferences;
let onTrades = false;

function showSettingsError(message) {
  settingsStatus.hidden = !message;
  settingsStatus.textContent = message;
}

function renderControl(control) {
  if (control.type === "checkbox") control.checked = preferences[control.name];
  else control.value = preferences[control.name];
}

function renderPageStatus() {
  pageStatus.hidden = !onTrades || preferences?.enabled !== true;
}

let loaded = true;
RoxolPreferences.watch((next) => {
  preferences = next;
  for (const control of controls) {
    renderControl(control);
    control.disabled = !loaded;
  }
  for (const group of groups) group.disabled = !next.enabled;
  renderPageStatus();
}, () => {
  loaded = false;
  showSettingsError("Roxol couldn't load your preferences.");
});

form.addEventListener("change", async ({ target: control }) => {
  if (!controls.includes(control)) return;
  const value = control.type === "checkbox" ? control.checked : control.value;
  try {
    await chrome.storage.local.set({ [control.name]: value });
    showSettingsError("");
  } catch {
    renderControl(control);
    showSettingsError("Roxol couldn't save this preference.");
  }
});

async function showAccount() {
  const status = document.querySelector("#account-status");
  try {
    const account = await chrome.runtime.sendMessage({ type: "roxol:read-account" });
    if (account?.status === "signed-in") {
      status.textContent = `Signed in as ${account.username}`;
      return;
    }
    if (account?.status === "signed-out") {
      status.textContent = "Sign in to Roblox to see your trades.";
      return;
    }
  } catch {
    // Extension reloads and browser errors share the unavailable state.
  }
  status.textContent = "Roblox session unavailable.";
}

async function showTradeTabStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;

  const reply = await chrome.tabs.sendMessage(tab.id, { type: "roxol:trade-page-status" });
  onTrades = reply?.ready === true;
  renderPageStatus();
}

document.querySelector("#open-trades").href = ROBLOX_TRADES_URL;
void showAccount();
// Most tabs do not have a Roxol content script.
void showTradeTabStatus().catch(() => {});
