import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { browserTargets, connect, launchEdge, waitFor } from "./edge.mjs";
import { channel, dataDir, order, readJson, saveJson } from "./store.mjs";

const requestedAccount = process.argv[2]?.trim().toLowerCase();
const backfill = process.argv[3] === "--backfill";
const limit = Number(process.argv[backfill ? 4 : 3] ?? (backfill ? 200 : 75));
if (!requestedAccount || !Number.isInteger(limit) || limit < (backfill ? 1 : 50) || limit > (backfill ? 200 : 100) ||
    process.argv.length > (backfill ? 5 : 4)) {
  throw new Error("Usage: node tools/overpay/collect.mjs <Discord alt username|--use-current-account> [50-100 | --backfill [1-200]]");
}

const profile = path.join(dataDir, "edge");
const messagesFile = path.join(dataDir, "messages.json");
const imagesDir = path.join(dataDir, "attachments");
const lockPath = path.join(dataDir, "collect.lock");
const overlap = 12;
const channelPath = new URL(channel).pathname;
const channelId = channelPath.split("/").at(-1);

function capture(expectedPath, id) {
  if (location.pathname !== expectedPath && !location.pathname.startsWith(expectedPath + "/")) return [];
  const list = document.querySelector('[data-list-id="chat-messages"]');
  if (!list) return [];
  return [...list.querySelectorAll('[id^="chat-messages-' + id + '-"]')].map((row) => {
    const messageId = row.id.split("-").at(-1);
    if (!/^\d{17,20}$/.test(messageId)) return null;
    const content = document.getElementById("message-content-" + messageId);
    const time = row.querySelector("time[datetime]");
    const edited = row.querySelector('[class*="edited"] time[datetime], time[datetime][class*="edited"]');
    const text = content?.innerText ?? "";
    const editCaption = /\(edited\)\s*\n\s*([A-Za-z]+, [A-Za-z]+ \d{1,2}, \d{4}) at (\d{1,2}:\d{2} [AP]M)\s*$/i.exec(text);
    const editTime = editCaption ? Date.parse(editCaption[1] + " " + editCaption[2]) : NaN;
    const urls = [...row.querySelectorAll("a[href], img[src]")].map((node) => node.href ?? node.src);
    const attachments = urls.flatMap((href) => {
      const url = new URL(href);
      const match = url.pathname.match(/^\/attachments\/(\d+)\/(\d+)\/[^/]+$/);
      if (!match || match[1] !== id || url.protocol !== "https:" ||
          !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) ||
          !/\.(?:png|jpe?g|webp|gif|avif)$/i.test(url.pathname)) return [];
      return [{ id: match[2], url: url.href }];
    });
    return {
      id: messageId, postedAt: time?.dateTime ?? new Date(Number((BigInt(messageId) >> 22n) + 1420070400000n)).toISOString(),
      editedAt: edited?.dateTime ?? (Number.isFinite(editTime) ? new Date(editTime).toISOString() : null),
      editedAtPrecision: edited?.dateTime ? "source" : Number.isFinite(editTime) ? "minute" : null,
      edited: Boolean(edited || editCaption || row.querySelector('[class*="edited"]')),
      text, attachments: [...new Map(attachments.toReversed().map((a) => [a.id, a])).values()],
    };
  }).filter(Boolean);
}

async function confirmAccount(tab, expected, anchor) {
  const settings = '[aria-label="User Settings"], [data-dnd-name="User Settings"]';
  const login = await waitFor(() => tab.evaluate((selector) =>
    location.pathname.startsWith("/login") || document.querySelector('input[type="password"]') ? "login" :
      document.querySelector(selector) ? "settings" : null, settings), "Discord sign-in or User Settings")
    .catch(async (error) => {
      const screen = await tab.evaluate(() => ({
        path: location.pathname, title: document.title, ready: document.readyState,
        labels: [...new Set([...document.querySelectorAll("[aria-label]")].map((node) => node.getAttribute("aria-label")))]
          .filter((label) => /settings|login|log in|sign in|verify|captcha/i.test(label)),
      }));
      throw new Error(error.message + " (" + JSON.stringify(screen) + ").", { cause: error });
    });
  if (login === "login") throw new Error("Discord requires sign-in. Run node tools/overpay/sign-in.mjs and close the dedicated window after signing in.");
  await tab.evaluate((selector) => document.querySelector(selector).click(), settings);
  const username = await waitFor(() => tab.evaluate(() => {
    const headings = [...document.querySelectorAll('h1, h2, h3, [role=heading], [class*="fieldTitle"]')];
    const heading = headings.find((node) => node.textContent.trim() === "Username");
    let field = heading?.parentElement;
    for (let depth = 0; field && depth < 4; depth++, field = field.parentElement) {
      if (headings.some((other) => other !== heading && field.contains(other) &&
          !heading.contains(other) && !other.contains(heading))) break;
      const candidates = field.innerText.split("\n").map((line) => line.trim()).filter((line) =>
        /^@?[a-z0-9_.]{2,32}(?:#\d{4})?$/.test(line) && !/^(?:edit|change)$/i.test(line));
      if (candidates.length === 1) return candidates[0].replace(/^@/, "").toLowerCase();
    }
    return null;
  }), "the Username field in Discord My Account");
  if (expected && username !== expected) {
    throw new Error("The dedicated Edge profile is signed into a different Discord account.");
  }
  await tab.send("Page.navigate", { url: anchor ? channel + "/" + anchor.id : channel });
  await waitFor(() => tab.evaluate((target) =>
    (location.pathname === target || location.pathname.startsWith(target + "/")) &&
    /(?:^|\|)\s*#value-requests\s*\|/i.test(document.title) &&
    Boolean(document.querySelector('[data-list-id="chat-messages"]')), channelPath), "the #value-requests channel and message list");
  console.log("Verified the Discord account and #value-requests.");
  return username;
}

async function scroll(tab, bottom) {
  return tab.evaluate((toBottom) => {
    const list = document.querySelector('[data-list-id="chat-messages"]');
    let scroller = list;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!scroller) throw new Error("Discord message scroller unavailable.");
    const before = scroller.scrollTop;
    if (toBottom) scroller.scrollTop = scroller.scrollHeight;
    else scroller.scrollTop -= Math.floor(scroller.clientHeight * 0.65);
    return { moved: before !== scroller.scrollTop, top: scroller.scrollTop <= 1 };
  }, bottom);
}

async function readBatch(tab, saved, anchor) {
  const snapshot = () => tab.evaluate(capture, channelPath, channelId);
  let rows = await waitFor(async () => {
    const view = await snapshot();
    return (anchor ? view.some(({ id }) => id === anchor.id) : view.length) && view;
  }, anchor ? "the oldest saved Discord post" : "the Discord message list");
  if (!anchor) {
    await scroll(tab, true);
    await delay(800);
    rows = await snapshot();
  }
  rows.sort(order);
  const newest = rows.at(-1);
  if (!newest) throw new Error("Discord returned an empty message list.");
  const collected = new Map(rows.map((row) => [row.id, row]));
  const prior = Object.values(saved.messages).sort(order);
  const boundary = prior.at(-overlap) ?? prior[0];
  for (let page = 0; page < 1000; page++) {
    const sorted = [...collected.values()].sort(order);
    const older = anchor && sorted.filter((row) => order(row, anchor) < 0);
    if (anchor && older.length >= limit) return older.slice(-limit);
    if (!anchor && !boundary && sorted.length >= limit) return sorted.slice(-limit);
    if (!anchor && boundary && order(sorted[0], boundary) < 1) {
      return sorted.filter((row) => order(row, boundary) >= 0 && order(row, newest) <= 0);
    }
    const position = await scroll(tab, false);
    let next;
    try {
      next = await waitFor(async () => {
        const view = (await snapshot()).sort(order);
        return view.length && order(view[0], rows[0]) < 0 && view;
      }, "older Discord messages", position.top ? 30 : 3);
    } catch (error) {
      if (position.moved && !position.top) continue;
      if (anchor && position.top && await tab.evaluate(() =>
        [...document.querySelectorAll("h1, h2, h3")].some((node) =>
          /^Welcome to #value-requests!?$/i.test(node.textContent.trim())))) return older;
      throw new Error("Could not reach the requested history boundary. Check that older messages load in #value-requests. Checkpoint unchanged.", { cause: error });
    }
    if (!next.some((row) => rows.some((priorRow) => row.id === priorRow.id))) {
      throw new Error("Discord skipped a section of the message list. Checkpoint unchanged.");
    }
    rows = next;
    for (const row of rows) collected.set(row.id, row);
  }
  throw new Error("The catch-up exceeded the paging limit. Checkpoint unchanged.");
}

async function saveAttachment(messageId, attachment, previous) {
  if (previous) {
    try {
      await stat(path.join(dataDir, previous.file));
      return previous;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const response = await fetch(attachment.url, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok || !/^image\//i.test(response.headers.get("content-type") ?? "")) {
    throw new Error("Could not save evidence " + attachment.id + " for message " + messageId);
  }
  const data = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(data).digest("hex");
  const extension = path.extname(new URL(attachment.url).pathname).toLowerCase();
  const file = path.join("attachments", messageId + "-" + attachment.id + "-" + sha256 + extension);
  const destination = path.join(dataDir, file);
  const staged = destination + "." + randomUUID() + ".tmp";
  await writeFile(staged, data, { flag: "wx" });
  await rename(staged, destination);
  return { id: attachment.id, file, sha256 };
}

await mkdir(imagesDir, { recursive: true });
const lock = await open(lockPath, "wx").catch((error) => {
  if (error.code === "EEXIST") throw new Error("Another collection holds " + lockPath);
  throw error;
});
let browser;
let tab;
try {
  const saved = await readJson(messagesFile, { version: 1, checkpoint: null, messages: {} });
  const anchor = backfill ? Object.values(saved.messages).sort(order)[0] : null;
  if (backfill && !anchor) throw new Error("Collect recent Discord posts before starting a backfill.");
  const expected = requestedAccount === "--use-current-account" ? saved.account : requestedAccount;
  if (saved.account && saved.account !== expected) throw new Error("This collection belongs to a different Discord account.");
  await mkdir(profile, { recursive: true });
  await rm(path.join(profile, "DevToolsActivePort"), { force: true });
  browser = launchEdge(profile, [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--window-size=1280,1000",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", channel,
  ]);
  const targets = await browserTargets(profile, browser);
  tab = await connect(await waitFor(async () => (await targets()).find((target) =>
    target.type === "page" && /^https:\/\/discord\.com\//.test(target.url)), "the Discord tab"));
  const account = await confirmAccount(tab, expected, anchor);
  const batch = await readBatch(tab, saved, anchor);
  let added = 0;
  for (const row of batch) {
    const previous = saved.messages[row.id];
    if (!previous) added++;
    const attachments = [];
    for (const attachment of row.attachments) {
      attachments.push(await saveAttachment(row.id, attachment, previous?.attachments.find(({ id }) => id === attachment.id)));
    }
    saved.messages[row.id] = { ...row, link: channel + "/" + row.id, attachments };
  }
  saved.account = account;
  if (!backfill) saved.checkpoint = Object.values(saved.messages).sort(order).at(-1).id;
  saved.lastCollection = new Date().toISOString();
  await saveJson(messagesFile, saved);
  console.log(JSON.stringify({ scanned: batch.length, added, stored: Object.keys(saved.messages).length,
    checkpoint: saved.checkpoint, ...(backfill ? { before: anchor.postedAt, oldest: batch[0]?.postedAt,
      newest: batch.at(-1)?.postedAt, attachments: batch.reduce((sum, row) => sum + row.attachments.length, 0) } : {}) }));
} finally {
  if (tab) await tab.send("Browser.close").catch(() => {});
  tab?.close();
  if (browser && browser.exitCode === null && !tab) browser.kill();
  await lock.close();
  await rm(lockPath, { force: true });
}
