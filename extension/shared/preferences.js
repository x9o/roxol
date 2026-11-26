const RoxolPreferences = (() => {
  const defaults = Object.freeze({
    appearance: "system",
    enabled: true,
    itemValue: true,
    itemIndicators: true,
    itemSales: true,
    itemOverpay: true,
    tradeComparisons: true,
    tradeItems: true,
    tradeProjected: true,
    historyCards: true,
    historyStats: true,
  });

  const keys = Object.keys(defaults);
  const themes = new Set(["system", "light", "dark"]);

  function normalize(settings) {
    return Object.fromEntries(keys.map((key) => {
      const value = settings[key];
      const valid = key === "appearance" ? themes.has(value) : typeof value === "boolean";
      return [key, valid ? value : defaults[key]];
    }));
  }

  function watch(render, onError = () => {}) {
    const stored = {};
    let ready = false;
    const pending = {};
    function update() {
      const preferences = normalize(stored);
      document.documentElement.dataset.roxolAppearance = preferences.appearance;
      render(preferences);
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const incoming = keys.filter((key) => Object.hasOwn(changes, key));
      if (!incoming.length) return;
      for (const key of incoming) (ready ? stored : pending)[key] = changes[key].newValue;
      if (ready) update();
    });

    void (async () => {
      try {
        Object.assign(stored, await chrome.storage.local.get(keys));
      } catch {
        onError();
      }
      Object.assign(stored, pending);
      ready = true;
      update();
    })();
  }

  return { watch };
})();
