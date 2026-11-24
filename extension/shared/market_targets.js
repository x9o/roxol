const RoxolTargets = (() => {
  function idOf(value) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
    return /^[1-9]\d{0,19}$/.test(String(value)) ? String(value) : null;
  }

  function targetOf(kind, id) {
    const validId = idOf(id);
    return validId && (kind === "asset" || kind === "bundle")
      ? { kind, id: validId } : null;
  }

  function routeOf(input) {
    let url;
    try {
      url = new URL(input, "https://www.roblox.com");
    } catch {
      return null;
    }
    if (url.origin !== "https://www.roblox.com") return null;

    const path = url.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i, "");
    const item = /^\/(catalog|bundles)\/([1-9]\d{0,19})(?:\/|$)/.exec(path);
    if (item) return { page: "detail", ...targetOf(item[1] === "bundles" ? "bundle" : "asset", item[2]) };
    const user = /^\/users\/([1-9]\d{0,19})\/(profile|inventory)\/?$/.exec(path);
    if (user) return { page: user[2], id: user[1] };
    return /^\/catalog\/?$/.test(path) ? { page: "catalog" } : null;
  }

  function keyOf({ kind, id }) {
    return `${kind}:${id}`;
  }

  function robloxItemUrl({ kind, id }) {
    return `https://www.roblox.com/${kind === "bundle" ? "bundles" : "catalog"}/${id}`;
  }

  function rolimonsSalesUrl({ kind, id }) {
    return `https://www.rolimons.com/${kind === "bundle" ? "bundlesales" : "itemsales"}/${id}`;
  }

  function amount(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  return { idOf, targetOf, routeOf, keyOf, robloxItemUrl, rolimonsSalesUrl, amount };
})();
