import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const code = await readFile(new URL("../../extension/background/market.js", import.meta.url), "utf8");

test("transient profile backoff survives an idle worker restart and stops after the third failure", async () => {
  const assetId = "101";
  const local = {};
  const session = {};
  let now = Date.parse("2026-11-25T12:00Z");
  let requests = 0;
  class WorkerDate extends Date {
    static now() { return now; }
  }
  const area = (storage) => ({
    get: async (key) => ({ [key]: structuredClone(storage[key]) }),
    set: async (entries) => Object.assign(storage, structuredClone(entries)),
  });

  function startWorker() {
    return new Promise((resolve) => {
      let listener;
      runInNewContext(code, {
        RoxolTargets: { routeOf: () => ({ page: "detail", kind: "asset", id: assetId }) },
        RoxolOverpaySampling: {
          async sampleItem({ readTradeProfile }) {
            const lookup = await readTradeProfile(assetId, now - 1000);
            resolve(lookup);
            return { status: "ok", pricingRetryAt: lookup.retryAt };
          },
        },
        chrome: {
          storage: { local: area(local), session: area(session) },
          runtime: { id: "roxol", onMessage: { addListener: (handler) => { listener = handler; } } },
        },
        Date: WorkerDate,
        AbortSignal,
        setTimeout,
        crypto,
        fetch: async () => {
          requests++;
          return new Response(null, { status: 503 });
        },
      });
      listener({ type: "roxol:market-overpay", assetId },
        { id: "roxol", frameId: 0, url: "https://www.roblox.com/catalog/101" }, () => {});
    });
  }

  const first = await startWorker();
  assert.equal(first.retryAt, now + 15_000);
  now += 5000;
  assert.equal((await startWorker()).retryAt, first.retryAt);
  assert.equal(requests, 1);
  now = first.retryAt;
  const second = await startWorker();
  assert.equal(second.retryAt, now + 45_000);
  now = second.retryAt;
  const third = await startWorker();
  assert.equal(third.retryAt, null);
  assert.equal(third.failure.httpStatus, 503);
  now += 60_000;
  assert.equal((await startWorker()).retryAt, null);
  assert.equal(requests, 3);
});
