(() => {
  // Match the Trades list and localized lists. The manifest match patterns
  // are broader because Chromium match patterns cannot check locale syntax.
  const tradesListPath = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/trades\/?$/i;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id === chrome.runtime.id && message?.type === "roxol:trade-page-status") {
      sendResponse({ ready: tradesListPath.test(location.pathname) });
    }
  });
})();
