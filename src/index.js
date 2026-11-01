"use strict";

const { Monitor } = require("./monitor");
const { getJson } = require("./transport");
const { createWebServer } = require("./web/server");
const defaultConfig = require("./config");

async function start(config = defaultConfig, { logger = console, requestJson = getJson } = {}) {
  const monitor = new Monitor(config, { logger, requestJson });
  const server = createWebServer(monitor, logger);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.expressPort, config.host, resolve);
  });
  server.on("error", () => logger.error("[WEB] HTTP server error."));
  monitor.start();
  logger.info(`[WEB] Listening on ${config.host}:${server.address().port}. Standalone REST monitor; no Discord login.`);
  let stopping;
  return {
    server, monitor,
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        const closing = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server.closeIdleConnections();
        const force = setTimeout(() => server.closeAllConnections(), 3000);
        force.unref();
        try { await Promise.all([monitor.stop(), closing]); }
        finally { clearTimeout(force); }
      })();
      return stopping;
    },
  };
}

function main() {
  start().then(runtime => {
    const shutdown = () => runtime.stop().catch(() => { process.exitCode = 1; });
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }).catch(error => {
    if (error.code === "EADDRINUSE") console.error("[STARTUP] Web port is already in use. Stop the old web server or set a different expressPort in src/config.js.");
    else if (error.code === "EACCES") console.error("[STARTUP] Permission denied binding the web port. Check src/config.js and your hosting allocation.");
    else console.error(`[STARTUP] ${error.message}`);
    process.exitCode = 1;
  });
}

if (require.main === module) main();

module.exports = { start, main };
