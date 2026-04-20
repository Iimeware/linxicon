# Linxicon bridge solver (hosting bundle)

Self-contained package: static UI, local similarity **database** (`public/data/linxicon-graph-scores.bin` + `linxicon-graph-meta.json`), word list, blocklist, and a small **Node** server that serves files and proxies Linxicon only when the UI needs the live API.

## Run locally

```bash
npm start
```

Open **http://localhost:8787/** (or the port in the `PORT` environment variable).

On Windows you can use `npm run start:ps` for the PowerShell server instead.

## What is the “database”?

| File | Role |
|------|------|
| `public/data/linxicon-graph-scores.bin` | ~35 MB `Float32` matrix: pairwise similarity scores used for fast / offline solves. |
| `public/data/linxicon-graph-meta.json` | Word order, `n`, build metadata (must match the `.bin` layout). |
| `public/data/linxicon-words.json` | Candidate vocabulary (~2959 words). |
| `public/data/linxicon-blocklist.json` | Substrings / exact tokens filtered from candidates. |

Keep these four files together under `public/data/`. If you replace `linxicon-words.json`, rebuild the graph (see scripts below).

## Deploy on a domain (Node)

1. Upload this entire folder to the host (Git repo, zip, etc.).
2. **Node 18+** required. No `npm install` dependencies; only the standard library is used.
3. Set **`PORT`** to the port your platform assigns (e.g. `8080`).
4. Start with **`npm start`** or **`node server.mjs`**.

Mount the app at the **site root** (`/`) so paths like `/data/...` and `/api/...` resolve correctly. For a subpath deployment you would need to adjust paths in `public/index.html` and routing in `server.mjs`.

### Docker

```bash
docker build -t linxicon-solver .
docker run -p 8080:8080 -e PORT=8080 linxicon-solver
```

### Offline behaviour

When both typed endpoints exist in the offline graph, the browser does not call `linxicon.com` (see in-app status text after load). Otherwise the server proxies `/api/dictionary` and `/api/updateSemantics` to `https://linxicon.com`.

## Regenerating data (optional)

- `npm run extract` — refresh `linxicon-words.json` from the bundled extractor (needs source JS path inside `scripts/extract-words.mjs` if URLs change).
- `npm run build-data` — Windows: refetch island-guesser and rebuild words + blocklist.
- `npm run build-graph` / `build-graph:fast` / `build-graph:resume` — rebuild the full matrix (long run; hits Linxicon).

## Giving this to Lovable

Import or upload this folder as a **Node** project with start command **`npm start`** and root **`public/`** served by **`server.mjs`**. If Lovable expects a SPA framework, you can still host this stack as-is on any Node-capable host (Railway, Fly.io, Render, a VPS) and point your domain there.

## Put it on GitHub (for Lovable or any host)

GitHub allows a single file up to **100 MB**; your `linxicon-graph-scores.bin` (~35 MB) is under that, so a normal Git push usually works. If a tool complains about repo size or large blobs, use **Git LFS** for the binary (below).

### One-time: create the repo on GitHub

1. On [github.com/new](https://github.com/new), create an empty repo (no README) — e.g. `linxicon-solver-host`.
2. Copy the repo URL (HTTPS or SSH), e.g. `https://github.com/YOU/linxicon-solver-host.git`.

### Push from your PC (this folder)

In PowerShell (folder path may differ):

```powershell
cd "C:\Users\temp8\Downloads\linxicon-solver-host"
git init
git add .
git commit -m "Linxicon solver bundle with offline graph"
git branch -M main
git remote add origin https://github.com/YOU/linxicon-solver-host.git
git push -u origin main
```

If `git` is not installed: install [Git for Windows](https://git-scm.com/download/win), then retry.

### “Author identity unknown” / “src refspec main does not match any”

Git needs a name and email before the first commit. Use your GitHub email (or GitHub’s private noreply address from **Settings → Emails**).

```powershell
cd "C:\Users\temp8\Downloads\linxicon-solver-host"
git config user.name "Your GitHub username"
git config user.email "YOUR_EMAIL@example.com"
git commit -m "Linxicon solver + offline graph"
git branch -M main
git push -u origin main
```

`--global` instead of the two `git config` lines above sets the same identity for every repo on this PC.

The **LF will be replaced by CRLF** lines are normal on Windows and are safe to ignore, or run `git config core.autocrlf true` once globally.

### If `git remote add origin` says remote already exists

You already added `origin`. Skip that line, or run `git remote set-url origin https://github.com/limeware/linxicon.git` to fix the URL, then `git push -u origin main`.

### If GitHub warns or rejects the large `.bin` — Git LFS

Install [Git LFS](https://git-lfs.com/) once (`git lfs install`). Then, **before** the first `git add` of the big file:

```powershell
cd "C:\Users\temp8\Downloads\linxicon-solver-host"
git lfs install
git lfs track "public/data/*.bin"
git add .gitattributes
git add .
git commit -m "Track graph binaries with Git LFS"
git push -u origin main
```

Anyone who clones must have Git LFS installed (`git lfs pull` runs automatically on checkout in recent Git). **Confirm whether Lovable supports Git LFS** on import; if not, use a release asset (next section).

### If Lovable still has an import size cap

1. **GitHub Release (manual):** In the repo → Releases → upload `linxicon-graph-scores.bin` as a release asset (large files allowed there). In Lovable, add a build step or script that downloads that URL into `public/data/` before `npm start` (you would need a small script or document the one-time download).
2. **Split hosting:** Keep code on GitHub; host the `.bin` on object storage (Cloudflare R2, S3) with a public URL and a tiny server route or build step to fetch it once — requires code changes.
3. **Private transfer:** Use GitHub for code only, send the `.bin` via cloud drive link to Lovable separately if they accept it.

### Optional: `.gitignore` for local rebuild junk

The bundle already ignores partial graph state. After running `build-graph`, do not commit `*.partial.bin` or `.linxicon-graph-build.json` unless you intend to share a paused build.
