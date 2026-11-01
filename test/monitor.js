"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Monitor } = require("../src/monitor");
const { createWebServer } = require("../src/web/server");
const { start } = require("../src/index");
const quiet = { info() {}, warn() {}, error() {} };
const fixture = () => ({
  players: 4, playingPlayers: 2, uptime: 90061000,
  memory: { free: 100, used: 128 * 1024 * 1024, allocated: 256 * 1024 * 1024, reservable: 1024 ** 3 },
  cpu: { cores: 6, systemLoad: 0.125, lavalinkLoad: 0.0175 },
});

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  const done = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await done;
}
async function harness(t) {
  const upstream = { mode: "ok", stats: fixture(), statsCalls: 0, infoCalls: 0, authorization: [], paths: [], infoDown: false };
  const ll = http.createServer((req, res) => {
    upstream.authorization.push(req.headers.authorization);
    upstream.paths.push(req.url);
    if (req.url === "/v4/stats") upstream.statsCalls++;
    if (req.url === "/v4/info") upstream.infoCalls++;
    if (upstream.mode === "timeout") return;
    res.setHeader("Content-Type", "application/json");
    if (upstream.mode === "401") { res.writeHead(401); return res.end('{"password":"test-password-private"}'); }
    if (upstream.mode === "500") { res.writeHead(500); return res.end("{}"); }
    if (upstream.mode === "malformed") return res.end("not-json");
    if (upstream.mode === "invalid" && req.url === "/v4/stats") return res.end('{"players":5}');
    if (req.url === "/v4/stats") return res.end(JSON.stringify(upstream.stats));
    if (req.url === "/v4/info") {
      if (upstream.infoDown) { res.writeHead(500); return res.end("{}"); }
      return res.end(JSON.stringify({
        version: { semver: "4.2.2" }, lavaplayer: "2.2.4", jvm: "21", password: "test-password-private",
        plugins: [{ name: '<svg onload="alert(1)">', version: "1.0.0" }], sourceManagers: ["youtube"], filters: ["equalizer"],
      }));
    }
    res.writeHead(404); res.end("{}");
  });
  await listen(ll);
  const config = {
    title: "Test monitor", operator: "Vinster Dourado", host: "127.0.0.1", expressPort: 0,
    pollIntervalMs: 100, requestTimeoutMs: 80, infoIntervalMs: 60000,
    nodes: [{ identifier: "Test node", host: "127.0.0.1", port: ll.address().port, password: "test-password-private", secure: false }],
  };
  const monitor = new Monitor(config, { logger: quiet });
  const web = createWebServer(monitor, quiet);
  const base = await listen(web);
  t.after(async () => { await monitor.stop(); await close(web); await close(ll); });
  return { upstream, monitor, base, config, ll };
}

async function json(base, path) { const response = await fetch(base + path); return { response, body: await response.json() }; }

test("reads actual node-wide stats, converts CPU fractions and exposes compatible APIs", async t => {
  const { upstream, monitor, base } = await harness(t);
  await monitor.pollOnce(0);
  assert.deepEqual(upstream.paths.sort(), ["/v4/info", "/v4/stats"]);
  assert(upstream.authorization.every(value => value === "test-password-private"));
  const { body } = await json(base, "/stats");
  assert.equal(body[0].online, true);
  assert.equal(body[0].players, 4);
  assert.equal(body[0].activePlayers, 2);
  assert.equal(body[0].playingPlayers, 2);
  assert.equal(body[0].systemLoad, 12.5);
  assert.equal(body[0].lavalinkLoad, 1.75);
  assert.equal(body[0].uptime, "1d 1h 1m 1s");
  assert.equal(body[0].memoryUsed, "128.00 MiB");
  assert.equal(body[0].memoryPercent, 12.5);
  assert.equal(body[0].info.version.semver, "4.2.2");
  assert(!JSON.stringify(body).includes("test-password-private"));
  const status = (await json(base, "/api/status")).body;
  assert.equal(status.summary.playingPlayers, 2);
  assert.equal(status.summary.players, 4);
  assert.equal(status.summary.status, "online");
  const info = (await json(base, "/info")).body;
  assert.equal(info[0].version.semver, "4.2.2");
  assert(!JSON.stringify(info).includes("test-password-private"));
  assert.equal((await json(base, "/readyz")).response.status, 200);
});

test("zero playing players is a valid live reading and never falls back to total players", async t => {
  const { upstream, monitor, base } = await harness(t);
  upstream.stats.players = 1;
  upstream.stats.playingPlayers = 0;
  await monitor.pollOnce(0);
  assert.equal(monitor.status().summary.playingPlayers, 0);
  const badge = (await json(base, "/api/v1/badge/players-json/0")).body;
  assert.equal(badge.message, "0 / 1");
  assert.equal(badge.schemaVersion, 1);
});

test("invalid password, failed requests and timeouts mark live data unavailable and recover", async t => {
  const { upstream, monitor, base } = await harness(t);
  await monitor.pollOnce(0);
  for (const mode of ["401", "500", "malformed", "invalid", "timeout"]) {
    upstream.mode = mode;
    await monitor.pollOnce(0);
    const node = monitor.snapshot()[0];
    assert.equal(node.online, false, mode);
    assert.equal(node.players, null, mode);
    assert.equal(node.activePlayers, null, mode);
    assert.equal(node.stale, true, mode);
    assert.equal(node.lastKnownStats.players, 4, mode);
    assert(node.error, mode);
    assert(!JSON.stringify(node).includes("test-password-private"));
    if (mode === "401") assert.match(node.error, /Authentication failed/);
    if (mode === "timeout") assert.match(node.error, /timed out/);
    assert.equal((await json(base, "/api/health")).response.status, 200);
    assert.equal((await json(base, "/readyz")).response.status, 503);
    assert.equal((await json(base, "/api/v1/badge/players-json/0")).body.message, "N/A");
  }
  upstream.mode = "ok";
  upstream.stats.playingPlayers = 3;
  await monitor.pollOnce(0);
  assert.equal(monitor.status().summary.status, "online");
  assert.equal(monitor.snapshot()[0].activePlayers, 3);
  assert.equal(monitor.snapshot()[0].lastKnownStats, null);
});

test("cached visitors and badges cannot trigger polling, spoof stats or fetch a Host-header URL", async t => {
  const { upstream, monitor, base } = await harness(t);
  await Promise.all([monitor.pollOnce(0), monitor.pollOnce(0), monitor.pollOnce(0)]);
  assert.equal(upstream.statsCalls, 1);
  for (let i = 0; i < 6; i++) {
    await json(base, "/stats"); await json(base, "/info");
    const response = await fetch(base + "/api/v1/badge/status/0", { headers: { Host: "127.0.0.1:1" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /image\/svg\+xml/);
    assert.match(await response.text(), /Online/);
  }
  assert.equal(upstream.statsCalls, 1);
  assert.equal(upstream.infoCalls, 1);
  assert.equal((await fetch(base + "/stats", { method: "POST", body: '{"stats":[]}' })).status, 405);
  assert.equal((await fetch(base + "/src/config.js")).status, 404);
  assert.equal((await fetch(base + "/api/v1/badge/status/0garbage")).status, 400);
  assert.equal((await fetch(base + "/api/v1/badge/status/-1")).status, 400);
  assert.equal((await fetch(base + "/api/v1/badge/status/5")).status, 400);
  assert.equal((await fetch(base + "/", { method: "HEAD" })).status, 200);
  const home = await fetch(base + "/");
  assert.match(home.headers.get("content-security-policy"), /script-src 'self'/);
  assert(!((await home.text()).includes("test-password-private")));
});

test("the website starts with an unreachable node and keeps retrying until it returns", async t => {
  const { upstream, config } = await harness(t);
  upstream.mode = "500";
  const runtime = await start(config, { logger: quiet });
  t.after(() => runtime.stop());
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal((await json(base, "/api/health")).response.status, 200);
  assert.equal(runtime.monitor.snapshot()[0].online, false);
  upstream.mode = "ok";
  const deadline = Date.now() + 1500;
  while (!runtime.monitor.snapshot()[0].online && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(runtime.monitor.snapshot()[0].online, true);
  await runtime.stop();
  const count = upstream.statsCalls;
  await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal(upstream.statsCalls, count);
});

test("stale readings expire and info failures do not incorrectly mark stats offline", async t => {
  const { upstream, monitor } = await harness(t);
  await monitor.pollOnce(0);
  upstream.infoDown = true;
  monitor.states[0].infoNext = 0;
  await monitor.pollOnce(0);
  assert.equal(monitor.snapshot()[0].online, true);
  assert.equal(monitor.snapshot()[0].infoStale, true);
  assert.equal(monitor.snapshot()[0].info.version.semver, "4.2.2");
  monitor.states[0].lastSuccess -= 10000;
  const node = monitor.snapshot()[0];
  assert.equal(node.online, false);
  assert.equal(node.players, null);
  assert.equal(node.stale, true);
  assert.match(node.error, /stale/);
});
