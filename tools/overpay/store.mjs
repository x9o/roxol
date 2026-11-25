import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const channel = "https://discord.com/channels/415246288779608064/535250426061258753";
export const dataDir = process.env.ROXOL_OVERPAY_DIR ??
  path.join(process.env.LOCALAPPDATA, "Roxol", "overpay");

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function saveJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const staged = file + "." + randomUUID() + ".tmp";
  await writeFile(staged, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  await rename(staged, file);
}

export function order(a, b) {
  return a.id.length - b.id.length || a.id.localeCompare(b.id);
}
