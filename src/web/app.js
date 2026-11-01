"use strict";

(() => {
  const $ = selector => document.querySelector(selector);
  const nodeElements = new Map();
  let busy = false;
  let timer;
  let snapshot;
  let lastReceived = 0;
  let disconnected = false;
  const number = value => value === null || value === undefined ? "—" : Number(value).toLocaleString();
  const time = value => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Not yet checked";
  const set = (root, selector, value) => { root.querySelector(selector).textContent = value; };
  const themeButton = $("#theme");
  function applyTheme(theme) {
    document.body.classList.toggle("light", theme === "light");
    themeButton.textContent = theme === "light" ? "Dark theme" : "Light theme";
  }
  try { applyTheme(localStorage.getItem("lavalink-theme") || "dark"); } catch { applyTheme("dark"); }
  themeButton.addEventListener("click", () => {
    const theme = document.body.classList.contains("light") ? "dark" : "light";
    applyTheme(theme);
    try { localStorage.setItem("lavalink-theme", theme); } catch { /* Theme still works without storage. */ }
  });

  function chips(root, selector, items, empty) {
    const container = root.querySelector(selector);
    container.replaceChildren();
    for (const item of items.length ? items : [empty]) {
      const chip = document.createElement("span");
      chip.textContent = item;
      container.append(chip);
    }
  }

  function updateNode(node) {
    let card = nodeElements.get(node.index);
    if (!card) {
      card = $("#node-template").content.firstElementChild.cloneNode(true);
      $("#nodes").append(card);
      nodeElements.set(node.index, card);
      card.querySelector(".copy-address").addEventListener("click", async event => {
        const button = event.currentTarget;
        const address = card.dataset.address;
        try {
          if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(address);
          else {
            const field = document.createElement("textarea");
            field.value = address;
            document.body.append(field);
            field.select();
            const copied = document.execCommand("copy");
            field.remove();
            if (!copied) throw new Error("copy-unavailable");
          }
          button.textContent = "Copied";
        } catch { button.textContent = "Copy unavailable"; }
        setTimeout(() => { button.textContent = "Copy address"; }, 1800);
      });
    }
    const live = node.online && !disconnected;
    card.classList.toggle("unavailable", !live);
    card.dataset.address = `${node.host}:${node.port}`;
    set(card, ".node-number", String(node.index + 1).padStart(2, "0"));
    set(card, ".node-name", node.node);
    set(card, ".node-address", `${node.secure ? "https" : "http"}://${node.host}:${node.port}`);
    const pill = card.querySelector(".state-pill");
    pill.textContent = disconnected ? "STALE" : node.status.toUpperCase();
    pill.className = `state-pill ${live ? "good" : node.status === "Checking" && !disconnected ? "" : "bad"}`;
    const error = card.querySelector(".node-error");
    error.textContent = disconnected ? "The website cannot fetch a fresh snapshot. Current readings are unavailable." : node.error || "";
    error.hidden = !error.textContent;
    set(card, '[data-field="playingPlayers"]', live ? number(node.playingPlayers) : "—");
    set(card, '[data-field="players"]', live ? number(node.players) : "—");
    set(card, '[data-field="uptime"]', live ? node.uptime : "—");
    set(card, '[data-field="latencyMs"]', live ? `${number(node.latencyMs)} ms` : "—");
    set(card, ".memory-value", live ? `${node.memoryUsed} / ${node.memoryReservable}` : "Unavailable");
    set(card, ".cpu-value", live && node.lavalinkLoad !== null ? `${node.lavalinkLoad.toFixed(2)}%` : "Unavailable");
    set(card, ".system-value", live && node.systemLoad !== null ? `System load: ${node.systemLoad.toFixed(2)}% · ${number(node.cores)} cores` : "System load unavailable");
    for (const [selector, value] of [[".memory-bar", node.memoryPercent], [".cpu-bar", node.lavalinkLoad]]) {
      const bar = card.querySelector(selector);
      bar.value = live ? Math.min(100, Math.max(0, value ?? 0)) : 0;
      bar.setAttribute("aria-valuetext", live && value !== null ? `${value}%` : "Unavailable");
    }
    const info = node.info;
    set(card, ".version", info ? `v${info.version.semver}${node.infoStale ? " · cached" : ""}` : "Version unavailable");
    set(card, ".detail-version", info?.version.semver || "Unavailable");
    set(card, ".detail-lavaplayer", info?.lavaplayer || "Unavailable");
    set(card, ".detail-jvm", info?.jvm || "Unavailable");
    set(card, ".detail-cores", live ? number(node.cores) : "Unavailable");
    const infoWarning = card.querySelector(".info-warning");
    infoWarning.textContent = node.infoError || (node.infoStale ? "Showing cached server details." : "");
    infoWarning.hidden = !infoWarning.textContent;
    chips(card, ".plugins", (info?.plugins || []).map(plugin => `${plugin.name} ${plugin.version}`), info ? "No plugins reported" : "Unavailable");
    chips(card, ".sources", info?.sourceManagers || [], info ? "No sources reported" : "Unavailable");
    chips(card, ".filters", info?.filters || [], info ? "No filters reported" : "Unavailable");
    set(card, ".last-check", `Last check ${time(node.lastCheckedAt)}`);
    card.querySelector(".badge-link").href = `/api/v1/badge/status/${node.index}`;
  }

  function render(data) {
    const staleMs = data.pollIntervalMs + data.requestTimeoutMs + 2000;
    const allOld = data.nodes.some(node => node.online && node.ageMs + (Date.now() - lastReceived) > staleMs);
    const unavailable = disconnected || allOld;
    const status = unavailable ? "offline" : data.summary.status;
    const labels = {
      online: ["Node is responding", "The stats API is available and reporting fresh data."],
      offline: [unavailable ? "Live status unavailable" : "Node unavailable", unavailable ? "Waiting for a fresh snapshot from the monitor." : "The monitor will keep checking automatically."],
      degraded: ["Some nodes unavailable", "Available nodes are still reporting stats."],
      checking: ["Checking the node", "Waiting for the first response."],
    };
    $("#overall-title").textContent = labels[status][0];
    $("#overall-note").textContent = labels[status][1];
    $("#overall-dot").className = `indicator ${status === "online" ? "good" : status === "checking" ? "" : "bad"}`;
    $("#total-online").textContent = unavailable ? "—" : `${data.summary.online} / ${data.summary.nodes}`;
    $("#total-playing").textContent = unavailable ? "—" : number(data.summary.playingPlayers);
    $("#total-players").textContent = unavailable ? "—" : number(data.summary.players);
    $("#node-count").textContent = `${String(data.nodes.length).padStart(2, "0")} NODE${data.nodes.length === 1 ? "" : "S"}`;
    $("#operator").textContent = data.operator;
    document.title = `${data.title} · ${labels[status][0]}`;
    $("#interval").textContent = `Checks every ${Math.round(data.pollIntervalMs / 1000)}s`;
    const seconds = Math.max(0, Math.floor((Date.now() - lastReceived) / 1000));
    $("#freshness").textContent = lastReceived ? `Snapshot ${seconds < 2 ? "just now" : `${seconds}s ago`}` : "Connecting…";
    for (const node of data.nodes) {
      const expired = node.online && node.ageMs + Date.now() - lastReceived > staleMs;
      updateNode(expired ? { ...node, online: false, status: "Offline", error: "Stats are stale. Waiting for a fresh Lavalink response." } : node);
    }
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    clearTimeout(timer);
    $("#refresh").disabled = true;
    try {
      const response = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("request-failed");
      const data = await response.json();
      if (!Array.isArray(data.nodes) || !data.summary) throw new Error("invalid-response");
      if (!snapshot) $("#nodes").replaceChildren();
      snapshot = data;
      disconnected = false;
      lastReceived = Date.now();
      $("#page-error").hidden = true;
      render(snapshot);
    } catch {
      disconnected = true;
      $("#page-error").textContent = "Unable to refresh this page's status. Retrying automatically; check the website's connection.";
      $("#page-error").hidden = false;
      if (snapshot) render(snapshot);
      else {
        $("#overall-title").textContent = "Live status unavailable";
        $("#overall-note").textContent = "The website will retry automatically.";
        $("#overall-dot").className = "indicator bad";
        $("#freshness").textContent = "Connection failed";
      }
    } finally {
      busy = false;
      $("#refresh").disabled = false;
      timer = setTimeout(refresh, Math.max(1000, snapshot?.pollIntervalMs || 5000));
    }
  }
  $("#refresh").addEventListener("click", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  setInterval(() => { if (snapshot) render(snapshot); }, 1000);
  void refresh();
})();
