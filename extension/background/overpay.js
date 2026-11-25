const OVERPAY_ORIGIN = "http://127.0.0.1:43127";
const OVERPAY_MAX_AGE = 3 * 86400000;

async function readOverpay(item) {
  const key = "overpay:" + RoxolTargets.keyOf(item);
  const settings = await chrome.storage.local.get(["overpayEnabled", key, "overpayLastCollection"]);
  if (!settings.overpayEnabled) return { status: "disabled" };
  let data;
  let offline = false;
  try {
    const response = await fetch(OVERPAY_ORIGIN + "/v1/items/" + item.kind + "/" + item.id, {
      cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Benchmark service unavailable");
    data = await response.json();
    if (data?.version !== 1 || data.kind !== item.kind || data.id !== item.id ||
        !Number.isFinite(Date.parse(data.lastCollection)) || !data.groups || typeof data.groups !== "object") {
      throw new Error("Invalid benchmark data");
    }
    await chrome.storage.local.set({ [key]: data, overpayLastCollection: data.lastCollection }).catch(() => {});
  } catch {
    offline = true;
    data = settings[key];
  }
  if (!data) return { status: "unavailable", lastCollection: settings.overpayLastCollection };
  const stale = Date.now() - Date.parse(data.lastCollection) > OVERPAY_MAX_AGE;
  return { ...data, offline, status: stale || offline ? "stale" : "ready" };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "roxol:overpay-item" || sender.id !== chrome.runtime.id || sender.frameId !== 0) return;
  const route = RoxolTargets.routeOf(sender.url);
  const item = RoxolTargets.targetOf(message.item?.kind, message.item?.id);
  if (!item || !["trades", "detail"].includes(route?.page) ||
      (route.page === "detail" && RoxolTargets.keyOf(route) !== RoxolTargets.keyOf(item))) return;
  readOverpay(item).then(reply, () => reply({ status: "unavailable" }));
  return true;
});
