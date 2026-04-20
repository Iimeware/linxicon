/**
 * One-time brute force: for each vocabulary word W, call updateSemantics with
 * oldWords = chunks of all other words and newWord = W. Fills a symmetric
 * similarity matrix (same scores Linxicon returns in-game).
 *
 * Usage:
 *   node scripts/build-graph.mjs [--base URL] [--chunk 2000] [--parallel 6] [--chunk-parallel 4] [--limit N]
 *   node scripts/build-graph.mjs --resume
 *
 * Speed (biggest wins):
 *   - Chunks for ONE word used to run one-after-another; now they run in batches (--chunk-parallel, default 4).
 *   - Raise --parallel (words in flight) up to 8 if you do not get HTTP 429/502.
 *   - Smaller --chunk (e.g. 1200) can shorten each request; more requests/chunks per row (chunk-parallel helps).
 *
 * Unfilled cells use sentinel -1 until computed (scores from API are in [0,1]).
 *
 * Checkpoint: every ~100 completed rows writes public/data/linxicon-graph-scores.partial.bin
 * + .linxicon-graph-build.json (delete after successful final write).
 */

import crypto from "node:crypto";
import fs from "fs/promises";
import { writeFileSync, writeSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

function log(msg) {
  writeSync(1, `${msg}\n`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "public", "data");
const PARTIAL_BIN = path.join(DATA, "linxicon-graph-scores.partial.bin");
const STATE_PATH = path.join(DATA, ".linxicon-graph-build.json");

const argv = process.argv.slice(2);
let BASE = "https://linxicon.com";
let CHUNK = 2000;
let PARALLEL_WORDS = 6;
/** How many oldWords chunks to fetch in parallel for a single vocabulary row (disjoint writes, safe). */
let CHUNK_PARALLEL = 4;
let LIMIT = 0;
let RESUME = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--base" && argv[i + 1]) BASE = String(argv[++i]).replace(/\/$/, "");
  else if (a === "--chunk" && argv[i + 1]) CHUNK = Math.max(100, Math.min(2500, Number(argv[++i])));
  else if (a === "--parallel" && argv[i + 1]) PARALLEL_WORDS = Math.max(1, Math.min(12, Number(argv[++i])));
  else if (a === "--chunk-parallel" && argv[i + 1])
    CHUNK_PARALLEL = Math.max(1, Math.min(8, Number(argv[++i])));
  else if (a === "--limit" && argv[i + 1]) LIMIT = Math.max(0, Number(argv[++i]));
  else if (a === "--resume") RESUME = true;
}

const STARTERS = { tl: "link", br: "lexicon" };
const CHECKPOINT_EVERY = 100;
const SENTINEL = -1;

function wordsKey(words) {
  return crypto.createHash("sha256").update(words.join("\0")).digest("hex").slice(0, 24);
}

function rowComplete(mat, n, wi) {
  for (let j = 0; j < n; j++) {
    if (j === wi) continue;
    const s = mat[wi * n + j];
    if (!Number.isFinite(s) || s === SENTINEL) return false;
  }
  return true;
}

function initMat(n) {
  const mat = new Float32Array(n * n);
  mat.fill(SENTINEL);
  for (let i = 0; i < n; i++) mat[i * n + i] = 0;
  return mat;
}

async function postUpdateSemantics(oldWords, newWord) {
  const body = JSON.stringify({
    oldWords,
    newWord,
    starters: STARTERS,
  });
  const r = await fetch(`${BASE}/api/updateSemantics`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "linxicon-graph-build/1",
    },
    body,
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  }
  let edges;
  try {
    edges = JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(edges)) throw new Error("Expected array of edges");
  return edges;
}

function otherEnd(edge, newWord) {
  const nw = `node-${newWord}`;
  if (edge.from === nw) return edge.to.replace(/^node-/, "");
  if (edge.to === nw) return edge.from.replace(/^node-/, "");
  return null;
}

async function fetchChunkWithSplitRetry(oldWords, newWord, minChunk = 80) {
  try {
    return await postUpdateSemantics(oldWords, newWord);
  } catch (e) {
    if (oldWords.length <= minChunk) throw e;
    const mid = Math.floor(oldWords.length / 2);
    const a = oldWords.slice(0, mid);
    const b = oldWords.slice(mid);
    const [ea, eb] = await Promise.all([
      fetchChunkWithSplitRetry(a, newWord, minChunk),
      fetchChunkWithSplitRetry(b, newWord, minChunk),
    ]);
    return [...ea, ...eb];
  }
}

function chunksForIndices(allExceptWi) {
  const out = [];
  for (let k = 0; k < allExceptWi.length; k += CHUNK) {
    out.push(allExceptWi.slice(k, k + CHUNK));
  }
  return out;
}

async function fillRow(mat, n, words, wi) {
  const W = words[wi];
  const others = [];
  for (let j = 0; j < n; j++) if (j !== wi) others.push(j);

  const indexChunks = chunksForIndices(others);

  async function applyChunk(idxChunk) {
    const oldWords = idxChunk.map((j) => words[j]);
    const edges = await fetchChunkWithSplitRetry(oldWords, W);
    const byOther = new Map();
    for (const e of edges) {
      const o = otherEnd(e, W);
      if (o) byOther.set(o, e.score);
    }
    for (const j of idxChunk) {
      const o = words[j];
      const s = byOther.get(o);
      if (typeof s === "number" && Number.isFinite(s)) {
        mat[wi * n + j] = s;
        mat[j * n + wi] = s;
      }
    }
  }

  for (let b = 0; b < indexChunks.length; b += CHUNK_PARALLEL) {
    const slice = indexChunks.slice(b, b + CHUNK_PARALLEL);
    await Promise.all(slice.map((idxChunk) => applyChunk(idxChunk)));
  }
}

async function mapPool(items, limit, fn) {
  let i = 0;
  async function worker() {
    while (true) {
      const j = i++;
      if (j >= items.length) break;
      await fn(items[j], j);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
}

async function main() {
  const pack = JSON.parse(await fs.readFile(path.join(DATA, "linxicon-words.json"), "utf8"));
  let words = pack.words;
  if (LIMIT > 0 && LIMIT < words.length) {
    words = words.slice(0, LIMIT);
    log(`--limit ${LIMIT}: using subset for test build`);
  }
  const n = words.length;
  const wkey = wordsKey(words);

  log(
    `Words: ${n}, chunk=${CHUNK}, chunk-parallel=${CHUNK_PARALLEL}, parallel words=${PARALLEL_WORDS}, base=${BASE}`,
  );
  log(`wordsKey=${wkey} resume=${RESUME}`);

  let mat = initMat(n);
  let loadedPartial = false;

  if (RESUME) {
    try {
      const st = JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
      if (st.n !== n || st.wordsKey !== wkey) throw new Error("state mismatch (different word list or length)");
      const buf = await fs.readFile(PARTIAL_BIN);
      if (buf.byteLength !== n * n * 4) throw new Error("partial bin size mismatch");
      mat.set(new Float32Array(buf.buffer, buf.byteOffset, n * n));
      loadedPartial = true;
      let ready = 0;
      for (let wi = 0; wi < n; wi++) if (rowComplete(mat, n, wi)) ready++;
      log(`Resumed partial matrix: ${ready}/${n} rows already complete`);
    } catch (e) {
      log(`Resume failed (${e.message}) — starting fresh`);
      mat = initMat(n);
    }
  } else {
    try {
      await fs.access(STATE_PATH);
      log("Note: a previous build state exists. Use --resume to continue it, or delete:");
      log("  " + STATE_PATH);
      log("  " + PARTIAL_BIN);
    } catch {
      /* no stale state */
    }
  }

  const t0 = Date.now();
  let done = 0;
  let lastCheckpointDone = 0;

  const saveCheckpoint = (reason) => {
    const buf = Buffer.from(mat.buffer, mat.byteOffset, mat.byteLength);
    writeFileSync(PARTIAL_BIN, buf);
    writeFileSync(
      STATE_PATH,
      JSON.stringify(
        {
          n,
          wordsKey: wkey,
          savedAt: new Date().toISOString(),
          reason,
          done,
        },
        null,
        2,
      ),
      "utf8",
    );
    log(`  checkpoint (${reason}): ${done}/${n} rows → partial bin + state`);
  };

  const shutdown = (sig) => {
    try {
      saveCheckpoint(sig || "shutdown");
      log("Saved. Re-run with: node scripts/build-graph.mjs --resume");
    } catch (e) {
      writeSync(2, `Checkpoint failed: ${e}\n`);
    }
    process.exit(sig ? 130 : 0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const indices = [...Array(n).keys()].filter((wi) => !rowComplete(mat, n, wi));
  if (indices.length === 0) {
    log("All rows already complete — writing final files only.");
  } else {
    log(`Work queue: ${indices.length} rows to fill`);
    await mapPool(indices, PARALLEL_WORDS, async (wi) => {
      await fillRow(mat, n, words, wi);
      if (!rowComplete(mat, n, wi)) {
        log(`  WARN row ${wi} (${words[wi]}) still has gaps after fillRow`);
      }
      done++;
      if (done % 10 === 0 || done === indices.length) {
        const sec = (Date.now() - t0) / 1000;
        const rate = done / sec;
        const remain = indices.length - done;
        const etaMin = rate > 0 ? (remain / rate / 60).toFixed(1) : "?";
        log(`  rows ${done}/${indices.length} in this run (${sec.toFixed(1)}s wall, ~${etaMin} min ETA for this run)`);
      }
      if (done - lastCheckpointDone >= CHECKPOINT_EVERY) {
        lastCheckpointDone = done;
        saveCheckpoint("periodic");
      }
    });
  }

  await fs.mkdir(DATA, { recursive: true });
  const suffix = LIMIT > 0 ? `.preview-${LIMIT}` : "";
  const metaPath = path.join(DATA, `linxicon-graph-meta${suffix}.json`);
  const binPath = path.join(DATA, `linxicon-graph-scores${suffix}.bin`);
  const meta = {
    version: 1,
    words,
    n,
    builtAt: new Date().toISOString(),
    chunk: CHUNK,
    base: BASE,
    starters: STARTERS,
    preview: LIMIT > 0 || undefined,
    wordsKey: wkey,
  };
  await fs.writeFile(metaPath, JSON.stringify(meta), "utf8");
  await fs.writeFile(binPath, Buffer.from(mat.buffer, mat.byteOffset, mat.byteLength));

  try {
    await fs.unlink(PARTIAL_BIN);
    await fs.unlink(STATE_PATH);
  } catch {
    /* ok */
  }

  const bytes = n * n * 4;
  log(`Wrote ${path.basename(metaPath)} + ${path.basename(binPath)} (${(bytes / 1e6).toFixed(2)} MB)`);
}

main().catch((e) => {
  try {
    writeSync(2, String(e && e.stack ? e.stack : e) + "\n");
  } catch {
    console.error(e);
  }
  process.exit(1);
});
