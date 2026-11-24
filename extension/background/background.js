importScripts(
  "../shared/market_targets.js", "../vendor/nevos/nte_sales_core.js",
  "../vendor/nevos/rolimons_item_details.js", "rolimons.js", "market.js",
);

const AUTHENTICATED_USER_URL = "https://users.roblox.com/v1/users/authenticated";
const SETTINGS_PAGE = chrome.runtime.getURL("popup/popup.html");

async function readAccount() {
  const response = await fetch(AUTHENTICATED_USER_URL, {
    credentials: "include",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });

  if (response.status === 401) return { status: "signed-out" };
  if (!response.ok) return { status: "unavailable" };

  const account = await response.json();
  if (!Number.isSafeInteger(account?.id) || account.id < 1 ||
      typeof account.name !== "string" || !account.name.trim()) {
    return { status: "unavailable" };
  }

  return { status: "signed-in", username: account.name };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.url !== SETTINGS_PAGE || message?.type !== "roxol:read-account") {
    return;
  }

  readAccount().then(sendResponse, () => sendResponse({ status: "unavailable" }));
  return true;
});
