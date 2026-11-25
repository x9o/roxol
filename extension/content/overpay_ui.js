const RoxolOverpay = (() => {
  const { element, link } = RoxolMarketUI;
  const signed = new Intl.NumberFormat(undefined, { signDisplay: "exceptZero", maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
  const syncDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const showDate = (value) => Number.isFinite(Date.parse(value)) ? date.format(new Date(value)) : null;
  const label = { swap: "One-for-one swap", "one-for-many": "One-for-many" };
  const sourcePattern = /^https:\/\/discord\.com\/channels\/415246288779608064\/535250426061258753\/[1-9]\d{0,19}$/;

  function request(item) {
    return chrome.runtime.sendMessage({ type: "roxol:overpay-item", item })
      .catch(() => ({ status: "unavailable" }));
  }

  function render(data, { shape, perspective } = {}) {
    if (!data || data.status === "disabled") return null;
    const panel = element("section", "roxol-market roxol-overpay");
    panel.setAttribute("aria-label", "Observed submitted-proof overpay");
    panel.append(element("strong", "roxol-overpay-heading",
      perspective ? "Observed submitted-proof OP · " + perspective : "Observed submitted-proof OP"));
    const last = Number.isFinite(Date.parse(data.lastCollection)) ? syncDate.format(new Date(data.lastCollection)) : null;
    if (data.status === "unavailable") {
      panel.append(element("p", "", "Benchmark service unavailable."));
    } else {
      if (data.status === "stale") {
        panel.append(element("p", "roxol-overpay-status", data.offline ? "Offline · saved benchmark" : "Stale benchmark"));
      }
      for (const key of shape ? [shape] : Object.keys(label)) {
        const group = data.groups?.[key];
        const row = element("div", "roxol-overpay-group");
        const count = group?.count ?? 0;
        row.append(element("strong", "", label[key]));
        const window = group?.window;
        const from = showDate(window?.from);
        const to = showDate(window?.to);
        row.append(element("span", "", count + (count === 1 ? " proof" : " proofs") +
          (from && to ? " · " + from + " – " + to : " · last 30 days")));
        if (Number.isFinite(group?.median) && Number.isFinite(group?.mean) &&
            group.middle50?.length === 2 && group.middle50.every(Number.isFinite)) {
          row.append(element("span", "", "Median " + signed.format(group.median) +
            " · Mean " + signed.format(group.mean) + " · Middle 50% " + group.middle50.map(signed.format).join(" to ")));
          if (Number.isFinite(group.trend)) row.append(element("span", "", "Median change " + signed.format(group.trend) + " vs prior 30 days"));
        } else {
          row.append(element("span", "roxol-overpay-status", "Benchmark needs " + (group?.minimum ?? 10) + " proofs"));
        }
        const links = Array.isArray(group?.links) ? group.links.filter((url) => sourcePattern.test(url)) : [];
        if (links.length) {
          const proofList = element("details", "roxol-overpay-proofs");
          proofList.append(element("summary", "", "Source posts (" + links.length + ")"));
          const list = element("ul");
          for (const [index, url] of links.entries()) {
            const item = element("li");
            item.append(link("Proof " + (index + 1), url, true));
            list.append(item);
          }
          proofList.append(list);
          row.append(proofList);
        }
        panel.append(row);
      }
      panel.append(element("p", "", "Voluntary submissions can overrepresent unusually high overpays."));
    }
    if (last) panel.append(element("p", "", "Last collected " + last + " UTC"));
    return panel;
  }
  return { request, render };
})();
