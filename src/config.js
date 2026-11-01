// All settings are here. No Discord bot, token, channel, or .env file is needed.
module.exports = {
  title: "Lavalink Status",
  operator: "Vinster Dourado",
  host: "0.0.0.0", // Listen on every interface, including hosting-panel allocations.
  // The web port is separate from Lavalink's port (6706).
  expressPort: Number(process.env.PORT || process.env.SERVER_PORT || process.env.expressPort || 11247),
  pollIntervalMs: 5000,
  requestTimeoutMs: 8000,
  infoIntervalMs: 60000,
  nodes: [
    {
      identifier: "HeavenCloud",
      host: "budget-us7.bot.heavencloud.in",
      port: 6706,
      password: "youshallnotpass",
      secure: false, // This node uses HTTP, not HTTPS.
    },
  ],
};
