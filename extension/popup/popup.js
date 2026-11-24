const themePicker = document.querySelector("#theme");
const settingsStatus = document.querySelector("#settings-status");
const themeKey = "appearance";
const themes = new Set(["system", "light", "dark"]);
let savedTheme = "system";

function renderTheme(value) {
  savedTheme = themes.has(value) ? value : "system";
  document.documentElement.dataset.theme = savedTheme;
  themePicker.value = savedTheme;
}

function showSettingsError(message) {
  settingsStatus.hidden = !message;
  settingsStatus.textContent = message;
}

async function loadTheme() {
  try {
    const settings = await chrome.storage.local.get(themeKey);
    renderTheme(settings[themeKey]);
    themePicker.disabled = false;
  } catch {
    showSettingsError("Roxol couldn't load your preferences.");
  }
}

themePicker.addEventListener("change", async () => {
  const nextTheme = themePicker.value;
  themePicker.disabled = true;
  try {
    await chrome.storage.local.set({ [themeKey]: nextTheme });
    renderTheme(nextTheme);
    showSettingsError("");
  } catch {
    renderTheme(savedTheme);
    showSettingsError("Roxol couldn't save your appearance preference.");
  } finally {
    themePicker.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[themeKey]) renderTheme(changes[themeKey].newValue);
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
  if (reply?.ready) {
    document.querySelector("#page-status").hidden = false;
    document.querySelector("#open-trades").hidden = true;
  }
}

document.querySelector("#open-trades").href = ROBLOX_TRADES_URL;
void loadTheme();
void showAccount();
// Most tabs do not have a Roxol content script.
void showTradeTabStatus().catch(() => {});
