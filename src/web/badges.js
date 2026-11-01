"use strict";

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
}

function badgeData(kind, node) {
  let message;
  if (kind === "status") message = node.status;
  if (kind === "players") message = node.online ? `${node.activePlayers} / ${node.players}` : "N/A";
  if (kind === "uptime") message = node.online ? node.uptime : "N/A";
  if (kind === "load") message = node.online && node.lavalinkLoad !== null ? `${node.lavalinkLoad.toFixed(2)}%` : "N/A";
  return {
    schemaVersion: 1,
    label: { status: "Status", players: "Players", uptime: "Uptime", load: "Load" }[kind],
    message,
    color: node.status === "Checking" ? "#78716c" : !node.online ? "#c05648" : kind === "status" ? "#328563" : "#397997",
    cacheSeconds: 0,
  };
}

function badgeSvg(data) {
  const left = Math.max(58, data.label.length * 7 + 20);
  const right = Math.max(56, data.message.length * 7 + 20);
  const width = left + right;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" role="img" aria-label="${escapeXml(data.label + ': ' + data.message)}"><title>${escapeXml(data.label + ': ' + data.message)}</title><clipPath id="r"><rect width="${width}" height="24" rx="4"/></clipPath><g clip-path="url(#r)"><rect width="${left}" height="24" fill="#343b41"/><rect x="${left}" width="${right}" height="24" fill="${data.color}"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Arial,sans-serif" font-size="11"><text x="${left / 2}" y="16">${escapeXml(data.label)}</text><text x="${left + right / 2}" y="16">${escapeXml(data.message)}</text></g></svg>`;
}

module.exports = { badgeData, badgeSvg };
