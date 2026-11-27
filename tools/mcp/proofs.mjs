import { readFile } from "node:fs/promises";
import { z } from "zod";

const proofLink = /^https:\/\/discord\.com\/channels\/415246288779608064\/535250426061258753\/(\d{17,20})$/;
const id = z.string().regex(/^[1-9]\d{0,19}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/i);
const item = z.object({
  kind: z.enum(["asset", "bundle"]),
  id,
  quantity: z.number().int().positive(),
  serial: id.nullish(),
});
const row = z.object({
  id: z.string(),
  link: z.string(),
  date: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
  offset: z.number().int().min(-720).max(840).nullish(),
  baskets: z.tuple([z.array(item).min(1).max(20), z.array(item).min(1).max(20)]),
  robux: z.tuple([z.number().int().nonnegative().nullable(), z.number().int().nonnegative().nullable()]),
  robuxBasis: z.string().max(80).nullish(),
  hashes: z.array(hash).min(1).max(20),
});

export async function loadProofs(file) {
  if (!file) return null;
  const document = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(document?.pricedTrades)) throw new Error("Proof export must contain a pricedTrades array.");
  const records = document.pricedTrades.flatMap((entry, index) => {
    if (entry?.conflict || entry?.status === "conflict") return [];
    const parsed = row.safeParse(entry);
    if (!parsed.success || proofLink.exec(parsed.data.link)?.[1] !== parsed.data.id) {
      throw new Error(`Invalid reviewed public proof at index ${index}.`);
    }
    const { id, link, date, offset, baskets, robux, robuxBasis, hashes } = parsed.data;
    return [{ postId: id, source: link, completedAtReported: date, offsetMinutes: offset ?? null,
      baskets, robux, robuxBasis: robuxBasis ?? null, evidenceSha256: hashes }];
  });
  records.sort((a, b) => b.completedAtReported.localeCompare(a.completedAtReported) || b.postId.localeCompare(a.postId));
  return { loadedAt: Date.now(), records };
}
