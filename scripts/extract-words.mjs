import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", "data");
fs.mkdirSync(outDir, { recursive: true });

const ORIGIN = "https://linxicon.com";

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "linxicon-solver-extract/1" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

let home = await fetchText(`${ORIGIN}/`);
let hashMatch = home.match(/\/_frsh\/js\/([^/]+)\/island-guesser\.js/);
if (!hashMatch) {
  home = await fetchText(`${ORIGIN}/game/797`);
  hashMatch = home.match(/\/_frsh\/js\/([^/]+)\/island-guesser\.js/);
}
if (!hashMatch) throw new Error("Could not find island-guesser.js hash (tried / and /game/797)");
const hash = hashMatch[1];
const guesser = await fetchText(`${ORIGIN}/_frsh/js/${hash}/island-guesser.js`);

const wordsMatch = guesser.match(/var L=(\[[\s\S]*?\]);var K=/);
if (!wordsMatch) throw new Error("Could not find word list var L in island-guesser.js");

/** @type {string[]} */
const words = Function(`"use strict"; return ${wordsMatch[1]}`)();
const normalized = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))].sort();

const kMatch = guesser.match(/var K=new Set\((\[[\s\S]*?\])\),Q=/);
const qMatch = guesser.match(/,Q=(\[[\s\S]*?\]);function V/);
const blockExact = kMatch ? Function(`"use strict"; return ${kMatch[1]}`)() : [];
const blockSubstr = qMatch ? Function(`"use strict"; return ${qMatch[1]}`)() : [];

const meta = {
  source: `${ORIGIN}/_frsh/js/${hash}/island-guesser.js`,
  extractedAt: new Date().toISOString(),
  wordCount: normalized.length,
  note:
    "This is the client-side allowlist used for fast dictionary checks in Linxicon. Full pairwise similarity is not shipped in the page; the solver discovers scores via /api/updateSemantics.",
};

fs.writeFileSync(
  path.join(outDir, "linxicon-words.json"),
  JSON.stringify({ meta, words: normalized }, null, 0),
);
fs.writeFileSync(
  path.join(outDir, "linxicon-blocklist.json"),
  JSON.stringify({ meta, exact: blockExact, substring: blockSubstr }, null, 0),
);

console.log(`Wrote ${normalized.length} words and blocklist to public/data/`);
