"use strict";

const http = require("node:http");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { badgeData, badgeSvg } = require("./badges");

function createWebServer(monitor, logger = console) {
  const files = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
    ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ].map(([route, [file, type]]) => [route, { body: readFileSync(path.join(__dirname, file)), type }]));

  return http.createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 16384 }, (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader("Cache-Control", "no-store");
    const send = (code, type, body) => {
      res.writeHead(code, { "Content-Type": type });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    const json = (code, value) => send(code, "application/json; charset=utf-8", JSON.stringify(value));
    try {
      const url = new URL(req.url, "http://localhost"); // Never use the request Host header for internal requests.
      const route = url.pathname;
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        req.resume();
        return json(405, { error: "Read-only status service. Use GET." });
      }
      if (files.has(route)) {
        const file = files.get(route);
        return send(200, file.type, file.body);
      }
      if (route === "/stats" || route === "/api/v1/stats") return json(200, monitor.snapshot());
      if (route === "/api/status") return json(200, monitor.status());
      if (route === "/info") return json(200, monitor.snapshot().map(node => ({
        ...node.info, node: node.node, online: node.online,
        updatedAt: node.infoUpdatedAt, stale: node.infoStale, message: node.infoError,
      })));
      if (route === "/api/health" || route === "/health" || route === "/readyz") {
        const status = monitor.status();
        const ready = status.summary.online === status.summary.nodes;
        return json(route === "/readyz" && !ready ? 503 : 200, {
          ok: true, ready, service: "lavalink-status", monitorUptimeMs: status.monitorUptimeMs,
          lavalink: status.summary.status, nodesOnline: status.summary.online, nodesTotal: status.summary.nodes,
        });
      }
      if (route === "/robots.txt") return send(200, "text/plain; charset=utf-8", "User-agent: *\nDisallow: /api/\nDisallow: /stats\nDisallow: /info\n");
      const badge = /^\/api\/v1\/badge\/(status|players|uptime|load)(-json)?\/([^/]+)$/.exec(route);
      if (badge) {
        const nodes = monitor.snapshot();
        if (!/^\d+$/.test(badge[3]) || Number(badge[3]) >= nodes.length) return json(400, { error: "Invalid node index." });
        const data = badgeData(badge[1], nodes[Number(badge[3])]);
        return badge[2] ? json(200, data) : send(200, "image/svg+xml; charset=utf-8", badgeSvg(data));
      }
      return json(404, { error: "Not found." });
    } catch {
      logger.error("[WEB] Request failed.");
      if (!res.headersSent) json(500, { error: "Unable to serve the request." });
      else res.end();
    }
  });
}

module.exports = { createWebServer };
