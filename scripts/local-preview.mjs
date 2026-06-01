import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cacheHandler from "../api/cache.mjs";
import commentsHandler from "../api/comments.mjs";
import coursesHandler from "../api/courses.mjs";
import refreshPairHandler from "../api/refresh-pair.mjs";
import reportCacheHandler from "../api/report-cache.mjs";
import restoreHandler from "../api/restore.mjs";
import schoolScriptHandler from "../api/school-script.mjs";
import sessionHandler from "../api/session.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const publicRoot = path.join(projectRoot, "public");
const port = Number(process.env.PORT || "4182");

const apiHandlers = new Map([
  ["/api/cache", cacheHandler],
  ["/api/comments", commentsHandler],
  ["/api/courses", coursesHandler],
  ["/api/refresh-pair", refreshPairHandler],
  ["/api/report-cache", reportCacheHandler],
  ["/api/restore", restoreHandler],
  ["/api/school-script", schoolScriptHandler],
  ["/api/session", sessionHandler],
]);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const file = url.pathname === "/" ? "/index.html" : url.pathname;
  const full = path.resolve(publicRoot, "." + file);

  if (!full.startsWith(publicRoot) || !fs.existsSync(full)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }

  res.setHeader("Content-Type", mime[path.extname(full)] || "application/octet-stream");
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Cache-Control", "no-store");

  if (url.pathname === "/_vercel/insights/script.js") {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.end("");
    return;
  }

  const handler = apiHandlers.get(url.pathname);
  if (handler) {
    try {
      await handler(req, res);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: error?.message || "服务器异常" }));
    }
    return;
  }

  sendStatic(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`preview http://127.0.0.1:${port}`);
});
