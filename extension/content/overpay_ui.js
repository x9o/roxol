const RoxolOverpay = (() => {
  const ui = RoxolMarketUI;
  const { element, tradingFigure: figure, tradingStat: stat } = ui;
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
  const proofChannel = "https://discord.com/channels/415246288779608064/535250426061258753";

  async function showProof(trade, label) {
    const body = ui.showDialog(`Trade proof · ${label}`);
    const images = element("div", "roxol-proof-images");
    const status = element("p", "roxol-overpay-note", "Loading attachments…");
    status.setAttribute("role", "status");
    body.append(images, status, ui.link("Open original Discord post", trade.discordUrl, true));
    let unavailable = 0;
    for (const [index, url] of trade.attachments.entries()) {
      const result = await ui.request("proof-image", { url });
      if (!body.isConnected) return;
      if (result?.status !== "ok") {
        unavailable++;
        continue;
      }
      const image = element("img");
      image.src = result.src;
      image.alt = `Trade proof attachment ${index + 1} of ${trade.attachments.length}`;
      try {
        await image.decode();
        images.append(image);
      } catch {
        unavailable++;
      }
      if (!body.isConnected) return;
    }
    status.textContent = unavailable === trade.attachments.length ? "Proof attachments couldn’t be loaded."
      : unavailable ? "Some proof attachments couldn’t be loaded." : "";
    status.hidden = !unavailable;
  }

  function proofRow(trade) {
    const row = element("li", "roxol-overpay-trade");
    const details = element("div");
    const given = element("div", "roxol-overpay-basket", `Give ${trade.given}`);
    const received = element("div", "roxol-overpay-basket", `Receive ${trade.opposite}`);
    const label = Number.isFinite(Date.parse(trade.date)) ? date.format(new Date(trade.date)) : "View proof";
    const proof = trade.attachments.length
      ? element("button", "roxol-link roxol-proof-trigger", label)
      : ui.link(label, trade.discordUrl, true);
    if (trade.attachments.length) {
      proof.type = "button";
      proof.setAttribute("aria-label", `Open proof attachments for ${label}`);
      proof.addEventListener("click", () => void showProof(trade, label));
    }
    details.append(given, received, proof);
    const value = element("div", "roxol-overpay-trade-values");
    value.append(figure(trade.net));
    row.append(details, value);
    return row;
  }

  function render(panel, data, assetId) {
    if (data.median !== null) {
      const rate = element("dl", "roxol-overpay-rate");
      rate.append(stat("Median OP", ui.format(data.median)));
      panel.append(rate);
    }

    const details = element("details", "roxol-disclosure roxol-overpay-details");
    const stats = element("dl", "roxol-stat-grid");
    stats.append(
      stat("Priced downgrades", ui.format(data.trades.length)),
      stat("Proof posts", ui.format(data.postCount)),
    );
    if (data.unpricedPosts) stats.append(stat("Posts outside the estimate", ui.format(data.unpricedPosts)));
    details.append(
      element("summary", "", "Estimate details"), stats,
      element("p", "roxol-overpay-note",
        "Uses the median of the absolute OP amounts from qualifying Nevos downgrades as a reference for either direction. Proof rows show the signed result for the target owner. Incoming Robux count after fees and outgoing Robux count in full."),
    );
    const download = ui.button("Download proof audit");
    download.addEventListener("click", () => ui.downloadJson(`roxol-overpay-${assetId}.json`, {
      assetId, source: "Nevos", exportedAt: new Date().toISOString(), ...data,
    }));
    details.append(download);
    panel.append(details);
    if (!data.trades.length) return;

    const history = element("details", "roxol-disclosure roxol-overpay-details roxol-overpay-history");
    const list = element("ul", "roxol-overpay-trades");
    history.append(element("summary", "", `Priced proofs (${ui.format(data.trades.length)})`), list);
    history.addEventListener("toggle", () => {
      if (history.open && !list.childElementCount) list.append(...data.trades.map(proofRow));
    });
    panel.append(history);
  }

  function mount(assetId, listingName) {
    const panel = element("section", "roxol-market roxol-overpay");
    panel.setAttribute("aria-label", "Trade proof overpay");
    const header = element("header", "roxol-overpay-header");
    header.append(element("h2", "roxol-trading-heading", "Trade proof overpay"),
      ui.link("Rolimon’s proof channel", proofChannel, true));
    const status = element("p", "roxol-overpay-note", "Loading trade proofs…");
    status.setAttribute("role", "status");
    panel.append(header, status);

    async function refresh() {
      const data = await ui.request("overpay", { assetId, listingName });
      if (data?.status !== "ok") {
        const messages = {
          "token-required": "Add your Nevos proof token in the Roxol toolbar popup, then refresh.",
          "access-denied": "Nevos denied access. Check your proof token in the Roxol toolbar popup.",
          "rate-limited": "Nevos asked Roxol to slow down. Try again shortly.",
        };
        status.textContent = messages[data?.reason] ?? "Trade proof data is unavailable.";
        return;
      }
      const notices = [];
      if (data.partial) notices.push("Nevos returned only part of its proof history.");
      if (data.median === null) notices.push("No proof captions with a clear downgrade and item totals for this item.");
      status.textContent = notices.join(" ");
      status.hidden = !notices.length;
      render(panel, data, assetId);
    }

    void refresh();
    return panel;
  }

  return { mount };
})();
