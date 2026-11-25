import { mkdir } from "node:fs/promises";
import path from "node:path";
import { launchEdge } from "./edge.mjs";
import { channel, dataDir } from "./store.mjs";

const profile = path.join(dataDir, "edge");
await mkdir(profile, { recursive: true });
const edge = launchEdge(profile, [channel], true);
edge.unref();
console.log("Sign in to the Discord alt in the Roxol Edge window. Open the channel, then close that window before collecting.");
