importScripts(
  "../shared/market_targets.js", "../shared/trades.js", "../vendor/nevos/nte_sales_core.js",
  "../shared/trade-valuations.js", "../shared/item-overpay.js",
  "../vendor/nevos/rolimons_item_details.js", "rolimons.js", "market.js",
);

const AUTHENTICATED_USER_URL = "https://users.roblox.com/v1/users/authenticated";
const SETTINGS_PAGE = chrome.runtime.getURL("popup/popup.html");

function fetchPrivateJson(url) {
  return fetch(url, {
    credentials: "include",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
}

async function readAccount() {
  const response = await fetchPrivateJson(AUTHENTICATED_USER_URL);
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

async function readTrade(id) {
  const [account, trade] = await Promise.all([
    fetchPrivateJson(AUTHENTICATED_USER_URL),
    fetchPrivateJson(`https://trades.roblox.com/v2/trades/${id}`),
  ]);
  if (!account.ok || !trade.ok) return null;
  const [user, detail] = await Promise.all([account.json(), trade.json()]);
  if (detail.id != null && RoxolTargets.idOf(detail.id) !== id) return null;
  return RoxolTrades.tradeOf(detail, RoxolTargets.idOf(user.id));
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "roxol:trade-detail" || sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
      RoxolTargets.routeOf(sender.url)?.page !== "trades") return;
  const id = RoxolTargets.idOf(message.id);
  if (!id) return;
  readTrade(id).then(reply, () => reply(null));
  return true;
});
