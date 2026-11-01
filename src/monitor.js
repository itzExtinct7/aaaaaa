"use strict";

const { getJson, UpstreamError } = require("./transport");

function nonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function percent(value) {
  const number = nonnegative(value);
  return number === null ? null : Number((number * 100).toFixed(2));
}

function formatBytes(value) {
  if (value === null || value === undefined) return "N/A";
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
}

function formatDuration(value) {
  if (value === null || value === undefined) return "N/A";
  const seconds = Math.floor(value / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  return `${days ? `${days}d ` : ""}${hours}h ${minutes}m ${seconds % 60}s`;
}

function normalizeStats(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      !Number.isInteger(raw.players) || raw.players < 0 ||
      !Number.isInteger(raw.playingPlayers) || raw.playingPlayers < 0 ||
      raw.playingPlayers > raw.players || nonnegative(raw.uptime) === null) {
    throw new Error("invalid-stats");
  }
  return {
    players: raw.players,
    playingPlayers: raw.playingPlayers, // Node-wide; never use this monitor's session players.
    uptime: raw.uptime,
    memory: {
      free: nonnegative(raw.memory?.free),
      used: nonnegative(raw.memory?.used),
      allocated: nonnegative(raw.memory?.allocated),
      reservable: nonnegative(raw.memory?.reservable),
    },
    cpu: {
      cores: nonnegative(raw.cpu?.cores),
      systemLoad: nonnegative(raw.cpu?.systemLoad),
      lavalinkLoad: nonnegative(raw.cpu?.lavalinkLoad),
    },
  };
}

function normalizeInfo(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.version?.semver !== "string") {
    throw new Error("invalid-info");
  }
  const strings = value => Array.isArray(value) ? value.filter(v => typeof v === "string") : [];
  // Explicit allowlist: upstream fields and credentials are never blindly exposed.
  return {
    version: { semver: raw.version.semver },
    lavaplayer: typeof raw.lavaplayer === "string" ? raw.lavaplayer : null,
    jvm: typeof raw.jvm === "string" ? raw.jvm : null,
    sourceManagers: strings(raw.sourceManagers),
    filters: strings(raw.filters),
    plugins: Array.isArray(raw.plugins) ? raw.plugins.filter(p => p && typeof p.name === "string")
      .map(p => ({ name: p.name, version: typeof p.version === "string" ? p.version : "Unknown" })) : [],
  };
}

function validateConfig(config) {
  if (!config || typeof config.host !== "string" || !config.host) throw new Error("Set a valid web bind host in src/config.js.");
  if (!Number.isInteger(config.expressPort) || config.expressPort < 0 || config.expressPort > 65535) {
    throw new Error("The web port must be a number from 1 to 65535 (0 is allowed for tests).");
  }
  for (const key of ["pollIntervalMs", "requestTimeoutMs", "infoIntervalMs"]) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`Set a positive ${key} in src/config.js.`);
  }
  if (!Array.isArray(config.nodes) || !config.nodes.length) throw new Error("Configure at least one Lavalink node in src/config.js.");
  config.nodes.forEach((node, index) => {
    if (!node || typeof node.host !== "string" || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])$/i.test(node.host) ||
        !Number.isInteger(node.port) || node.port < 1 || node.port > 65535 ||
        typeof node.password !== "string" || !node.password || /[\r\n]/.test(node.password) ||
        typeof node.identifier !== "string" || !node.identifier.trim() || typeof node.secure !== "boolean") {
      throw new Error(`Invalid Lavalink node at index ${index}. Check host, port, password, identifier and secure in src/config.js.`);
    }
  });
}

function publicError(error) {
  if (error instanceof UpstreamError) {
    if (error.status === 401 || error.status === 403) return `Authentication failed (HTTP ${error.status}). Check the Lavalink password.`;
    if (error.status === 404) return "Lavalink v4 endpoint not found (HTTP 404). Check the host, port and Lavalink version.";
    return `Lavalink returned HTTP ${error.status}.`;
  }
  if (["TimeoutError", "AbortError"].includes(error?.name)) return "Lavalink request timed out. Retrying automatically.";
  if (["invalid-stats", "invalid-info", "response-too-large"].includes(error?.message) || error instanceof SyntaxError) {
    return "Lavalink returned an invalid response. Check that this is a Lavalink v4 server.";
  }
  const code = error?.cause?.code || error?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Could not resolve the Lavalink hostname. Retrying automatically.";
  if (code === "ECONNREFUSED") return "Lavalink refused the connection. Check that the node is running on this port.";
  return "Could not reach Lavalink. Check the node address, HTTP/HTTPS setting and firewall. Retrying automatically.";
}

class Monitor {
  constructor(config, { requestJson = getJson, logger = console } = {}) {
    validateConfig(config);
    this.config = config;
    this.requestJson = requestJson;
    this.logger = logger;
    this.startedAt = Date.now();
    this.running = false;
    this.states = config.nodes.map(node => ({
      node, online: null, stats: null, info: null, error: null, infoError: null,
      lastChecked: null, lastSuccess: null, infoUpdated: null, infoNext: 0,
      latencyMs: null, pending: null, timer: null, controllers: new Set(),
    }));
  }

  async request(state, path) {
    const controller = new AbortController();
    state.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), this.config.requestTimeoutMs);
    try {
      return await this.requestJson(`http${state.node.secure ? "s" : ""}://${state.node.host}:${state.node.port}${path}`, {
        headers: { Authorization: state.node.password, Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      state.controllers.delete(controller);
    }
  }

  async pollStats(state) {
    const before = performance.now();
    const wasOnline = state.online;
    const oldError = state.error;
    try {
      const stats = normalizeStats(await this.request(state, "/v4/stats"));
      if (state.stats && stats.uptime < state.stats.uptime) state.infoNext = 0;
      state.stats = stats;
      state.online = true;
      state.error = null;
      state.lastSuccess = Date.now();
      state.latencyMs = Math.round(performance.now() - before);
      if (wasOnline !== true) this.logger.info(`[NODE] ${state.node.identifier}: online`);
    } catch (error) {
      state.online = false;
      state.error = publicError(error);
      state.latencyMs = null;
      if (wasOnline !== false || oldError !== state.error) this.logger.warn(`[NODE] ${state.node.identifier}: ${state.error}`);
    } finally {
      state.lastChecked = Date.now();
    }
  }

  async pollInfo(state) {
    if (Date.now() < state.infoNext) return;
    state.infoNext = Date.now() + this.config.infoIntervalMs;
    try {
      state.info = normalizeInfo(await this.request(state, "/v4/info"));
      state.infoUpdated = Date.now();
      state.infoError = null;
    } catch (error) {
      state.infoError = publicError(error);
    }
  }

  pollOnce(index) {
    const state = this.states[index];
    if (state.pending) return state.pending;
    state.pending = Promise.all([this.pollStats(state), this.pollInfo(state)])
      .finally(() => { state.pending = null; });
    return state.pending;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.states.forEach((state, index) => {
      const run = async () => {
        try { await this.pollOnce(index); }
        catch { this.logger.error(`[NODE] ${state.node.identifier}: monitor error; retrying.`); }
        if (this.running) state.timer = setTimeout(run, this.config.pollIntervalMs);
      };
      void run();
    });
  }

  async stop() {
    this.running = false;
    for (const state of this.states) {
      clearTimeout(state.timer);
      for (const controller of state.controllers) controller.abort();
    }
    await Promise.allSettled(this.states.map(state => state.pending));
  }

  snapshot() {
    const now = Date.now();
    const iso = value => value === null ? null : new Date(value).toISOString();
    return this.states.map((state, index) => {
      const ageMs = state.lastSuccess === null ? null : now - state.lastSuccess;
      const expired = ageMs !== null && ageMs > this.config.pollIntervalMs + this.config.requestTimeoutMs + 2000;
      const online = state.online === true && !expired;
      const stats = online ? state.stats : null;
      const memoryPercent = stats?.memory.reservable > 0 && stats.memory.used !== null
        ? Number((stats.memory.used / stats.memory.reservable * 100).toFixed(2)) : null;
      return {
        index,
        node: state.node.identifier,
        host: state.node.host,
        port: state.node.port,
        secure: state.node.secure,
        online,
        status: state.online === null ? "Checking" : online ? "Online" : "Offline",
        stale: state.stats !== null && !online,
        error: expired && state.online ? "Stats are stale. Waiting for a fresh Lavalink response." : state.error,
        lastCheckedAt: iso(state.lastChecked),
        lastSuccessAt: iso(state.lastSuccess),
        ageMs,
        latencyMs: online ? state.latencyMs : null,
        players: stats?.players ?? null,
        activePlayers: stats?.playingPlayers ?? null,
        playingPlayers: stats?.playingPlayers ?? null,
        uptime: formatDuration(stats?.uptime),
        uptimeMs: stats?.uptime ?? null,
        cores: stats?.cpu.cores ?? null,
        systemLoad: percent(stats?.cpu.systemLoad),
        lavalinkLoad: percent(stats?.cpu.lavalinkLoad),
        memoryUsed: formatBytes(stats?.memory.used),
        memoryReservable: formatBytes(stats?.memory.reservable),
        memoryPercent,
        stats,
        info: state.info,
        infoUpdatedAt: iso(state.infoUpdated),
        infoStale: state.infoUpdated !== null && (state.infoError !== null || now - state.infoUpdated > this.config.infoIntervalMs + this.config.requestTimeoutMs),
        infoError: state.infoError,
        // Old readings are explicitly separate; never present them as current counters.
        lastKnownStats: !online ? state.stats : null,
      };
    });
  }

  status() {
    const nodes = this.snapshot();
    const online = nodes.filter(node => node.online);
    const total = key => online.length ? online.reduce((sum, node) => sum + (node[key] ?? 0), 0) : null;
    return {
      title: this.config.title,
      operator: this.config.operator,
      version: "2.0.0",
      generatedAt: new Date().toISOString(),
      monitorStartedAt: new Date(this.startedAt).toISOString(),
      monitorUptimeMs: Date.now() - this.startedAt,
      pollIntervalMs: this.config.pollIntervalMs,
      requestTimeoutMs: this.config.requestTimeoutMs,
      summary: {
        nodes: nodes.length,
        online: online.length,
        status: nodes.every(node => node.status === "Checking") ? "checking" : online.length === nodes.length ? "online" : online.length ? "degraded" : "offline",
        players: total("players"),
        playingPlayers: total("playingPlayers"),
      },
      nodes,
    };
  }
}

module.exports = { Monitor, validateConfig, normalizeStats, formatDuration, formatBytes };
