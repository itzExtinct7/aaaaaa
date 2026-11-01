"use strict";

const http = require("node:http");
const https = require("node:https");

class UpstreamError extends Error {
  constructor(status) { super("upstream-http"); this.status = status; }
}

// Only GET: no Lavalink sessions, players, voice connections or Discord login.
function getJson(url, { headers, signal }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.get(target, { headers, signal, maxHeaderSize: 16384 }, response => {
      // Deliberately do not follow redirects or forward Authorization elsewhere.
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new UpstreamError(response.statusCode));
        response.destroy();
        return;
      }
      let size = 0;
      const chunks = [];
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          reject(new Error("response-too-large"));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("response-aborted")));
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
  });
}

module.exports = { getJson, UpstreamError };
