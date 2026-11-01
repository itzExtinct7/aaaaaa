# Lavalink Status — standalone web edition

A standalone adaptation of [imanimtiyaz20/lavalink-status](https://github.com/imanimtiyaz20/lavalink-status). It reads the Lavalink v4 REST API directly. It does not log in to Discord, open a Lavalink WebSocket, create a player, or join voice channels.

## Start

Use **Node.js 22 or newer**. No external packages, bot token, Discord application, channel ID or `.env` file are required.

1. Extract the ZIP and put `index.js`, `package.json`, and the `src` folder directly in your server's working directory (usually `/home/container` in a hosting panel).
2. Set the startup command to:

   ```sh
   node index.js
   ```

   `npm start`, `node .`, and `node src/index.js` also work. There is nothing to install; `npm install` is optional.

3. Open your provider's IP/domain using the allocated **web port**. With your existing allocation, this is:

   **http://78.154.103.43:11247/**

   This download does not deploy to that address; it works there after you upload it and start it on the allocated server.

## Already configured

All settings are in `src/config.js`:

```js
{
  host: "0.0.0.0",       // Web server bind address
  expressPort: 11247,    // Web server port
  pollIntervalMs: 5000,
  requestTimeoutMs: 8000,
  infoIntervalMs: 60000,
  nodes: [{
    identifier: "HeavenCloud",
    host: "budget-us7.bot.heavencloud.in",
    port: 6706,         // Lavalink port, separate from the web server
    password: "youshallnotpass",
    secure: false      // HTTP: this node does not use HTTPS
  }]
}
```

If the provider sets `PORT`, `SERVER_PORT`, or `expressPort`, that environment value overrides the web port, in that order. No environment variables are required. For a different web allocation, change `expressPort` or use the provider's port setting. The server listens on all interfaces.

If replacing an older installation, replace its `index.js`, `package.json` and entire `src` folder with these files. Old `node_modules` are unused. Stop the old status process before starting this version so it does not occupy the same port. Lavalink itself should keep running separately.

## What the page shows

- Node reachability, last successful check and REST request response time.
- Node-wide **Now playing** from `playingPlayers` and **total players** from `players`. A valid `0` stays `0`; paused or idle players can make the total higher than the playing count.
- Actual Lavalink uptime, CPU cores, system and Lavalink CPU load, JVM memory usage and maximum JVM memory. Lavalink CPU fractions are multiplied by 100 for percentages.
- Lavalink/Lavaplayer/Java versions, installed plugins, enabled sources and filters.
- Refresh button, automatic updates without page reloads, persistent color theme, address copy button and SVG badges.

The page polls its own backend; the backend caches stats. Extra visitors or badge requests do not create extra requests to Lavalink. Each node is checked independently. The next check runs about five seconds after the previous check finishes, so timeouts and network latency can extend the effective interval. Server info refreshes about once a minute.

The website starts even when Lavalink is unavailable, continues checking indefinitely, and recovers automatically. Failures show a reason without crashing the website. Live readings become unavailable instead of silently showing old values as current. Previous readings, if any, remain explicitly labelled `lastKnownStats` in the JSON API. Missing CPU or memory fields are shown as unavailable.

**Reachable stats do not prove audio playback works.** This status website does not test YouTube searches, track loading, voice connections, or audio delivery, and it does not fix problems in those services. It does not show song titles: Lavalink's global stats contain counts, while individual players belong to each client's session. Frame stats are not available from `/v4/stats`.

## API and badges

| Route | Purpose |
| --- | --- |
| `/api/status` | Full status snapshot, summary, raw normalized stats and server info |
| `/stats` | Node array compatible with the original website's fields |
| `/api/v1/stats` | Alias for `/stats` |
| `/info` | Cached server information in original array form |
| `/api/health` or `/health` | HTTP 200 while the website runs; `ready` and `lavalink` describe node health |
| `/readyz` | HTTP 200 when all configured nodes have fresh stats; otherwise 503 |
| `/api/v1/badge/status/0` | Online/offline SVG badge |
| `/api/v1/badge/players/0` | Playing / total players SVG badge |
| `/api/v1/badge/uptime/0` | Lavalink uptime SVG badge |
| `/api/v1/badge/load/0` | Lavalink CPU load SVG badge |

Append `-json` to the badge type for Shields-style JSON, for example `/api/v1/badge/status-json/0`. Replace `0` with the zero-based node index if you add more nodes. Offline badges show Offline or N/A, and all badge JSON includes `schemaVersion: 1`.

Existing badge example:

```md
[![Lavalink status](http://78.154.103.43:11247/api/v1/badge/status/0)](http://78.154.103.43:11247/)
```

The API accepts GET and HEAD only. The old public `POST /stats` endpoint has been removed; visitors cannot overwrite status. Only the backend reads the password in `src/config.js`; the website's public routes do not serve it. SVG output is escaped and badges are generated directly from cached data without making requests to a supplied Host header.

## Hosting notes

This is a **Node.js web service**, so it needs a Node.js host, VPS or hosting panel. GitHub Pages alone cannot run its backend. The web service and Java Lavalink service run separately, using different ports. If the hosting panel stops a server with no open port, this project keeps the allocated web port open. Use the panel's normal restart policy to restart the website if the process itself stops.

- **Port already in use:** stop the old web process or choose another allocated web port.
- **Authentication failed:** check `password` in `src/config.js` against Lavalink's configuration.
- **Connection refused / timeout:** make sure Lavalink is running on port 6706, the hostname resolves, and your host can reach it.
- **HTTPS error:** this node uses HTTP (`secure: false`). HTTPS for the website is a separate reverse-proxy/provider setting.
- **Site does not open externally:** check that the web port is allocated/open and that a provider environment variable has not changed the listening port. The startup log prints the actual port.

## Validation

```sh
npm test
npm run check
```

The included integration tests use local simulated Lavalink servers, covering real player-count mapping, legitimate zero counts, CPU conversion, authentication failures, malformed responses, timeouts, automatic recovery, stale data, cached polling, badges, read-only routes and credential exposure.

Upstream is MIT licensed; the original license and copyright notice are preserved in `LICENSE`. Standalone adaptation prepared for Vinster Dourado.
