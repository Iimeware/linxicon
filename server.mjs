import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 8787);
const UPSTREAM = "https://linxicon.com";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...headers });
  res.end(body);
}

async function proxyDictionary(url, res) {
  const target = `${UPSTREAM}${url.pathname}${url.search}`;
  const r = await fetch(target, { headers: { "user-agent": "linxicon-solver-proxy/1" } });
  const text = await r.text();
  send(res, r.status, text, {
    "content-type": r.headers.get("content-type") || "text/plain",
    ...corsHeaders(),
  });
}

async function proxyUpdateSemantics(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString("utf8");
  const r = await fetch(`${UPSTREAM}/api/updateSemantics`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "linxicon-solver-proxy/1",
    },
    body,
  });
  const text = await r.text();
  send(res, r.status, text, {
    "content-type": r.headers.get("content-type") || "application/json",
    ...corsHeaders(),
  });
}

function corsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, HEAD, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    ...extra,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "OPTIONS" && url.pathname.startsWith("/api")) {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dictionary") {
      await proxyDictionary(url, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/updateSemantics") {
      await proxyUpdateSemantics(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      let filePath = path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname);
      if (!filePath.startsWith(PUBLIC)) {
        send(res, 403, "Forbidden");
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const data = req.method === "HEAD" ? null : fs.readFileSync(filePath);
        res.writeHead(200, {
          "content-type": MIME[ext] || "application/octet-stream",
          ...corsHeaders(),
          ...(data ? { "content-length": data.length } : {}),
        });
        res.end(data);
        return;
      }
    }

    send(res, 404, "Not found");
  } catch (e) {
    console.error(e);
    send(res, 500, String(e));
  }
});

server.listen(PORT, () => {
  console.log(`Linxicon solver: http://localhost:${PORT}/`);
  console.log(`  mirror:      http://127.0.0.1:${PORT}/  (if localhost does not connect)`);
  console.log(`Proxying ${UPSTREAM}/api/* when the UI needs the live API`);
});
