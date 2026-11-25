import path from "node:path";
import { readJson, saveJson } from "./store.mjs";
import { normalizeTrades } from "./trade-valuations.mjs";
import { validateTrades } from "./trade-validation.mjs";

const [input, completed, output, ...extra] = process.argv.slice(2);
if (!input || !completed || !output || extra.length ||
    [input, completed].some((file) => path.resolve(file).toLowerCase() === path.resolve(output).toLowerCase())) {
  throw new Error("Usage: node tools/overpay/validate-trades.mjs <trades.json> <pilot.json> <audit.json>");
}

const [source, pilot] = await Promise.all([readJson(input), readJson(completed)]);
const { summary, proofs } = validateTrades(normalizeTrades(source), pilot);
await saveJson(output, { sourceUrl: source.sourceUrl ?? null, pages: source.pages ?? null,
  generatedAt: new Date().toISOString(), summary, proofs });
console.log(JSON.stringify(summary, null, 2));
