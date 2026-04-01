# XO Multiplayer — Nakama Server-Authoritative Game

A real-time multiplayer Tic-Tac-Toe game built with a **server-authoritative Nakama backend**, focused on fairness, reliability, and a clean full-stack architecture.

---

## Live Deployment

| Service             | URL                                             |
| ------------------- | ----------------------------------------------- |
| **Frontend**        | https://xo-xo-nakama.ranasushil026.workers.dev/ |
| **Nakama Backend**  | https://xo-xo-nakama-production.up.railway.app  |
| **Nakama API Port** | 443 (TLS)                                       |

### Infrastructure

- **Backend**: [Railway](https://railway.app) — Nakama 3.22.0 + PostgreSQL, auto-deployed from `main` branch
- **Frontend**: [Cloudflare Pages](https://pages.cloudflare.com) — Vite/React, globally distributed via Cloudflare CDN

---

## Features

- Real-time online gameplay over WebSockets
- Server-authoritative game logic (validated moves, no client trust)
- Auto-matchmaking (2-player pairing)
- Public/private room system with shareable room codes
- Host knock-and-accept flow for room entry control
- Server-side turn timer enforcement (30s per move)
- Forfeit, timeout, draw, and standard win handling
- Persistent profiles (rating, streaks, games played)
- Match history with detailed move sequence and mini-board replay
- Dual leaderboards: **All-time** and **Monthly (resets on the 1st)**
- Profile analytics (opening heatmap, activity heatmap, rating progression)
- Reconnect-safe state resync
- Local pass-and-play mode
- Mobile-friendly, tactical UI style
- Installable as PWA on iOS (Safari) and Android (Chrome) — no app store required
- Offline-capable via PWA service worker — static assets and local play work without a connection

---

## Project Structure

```
.
├── apps
│   ├── server
│   │   └── nakama
│   │       ├── Dockerfile
│   │       ├── railway.toml
│   │       └── modules
│   │           └── matches
│   │               └── xoxo.js
│   └── web
│       ├── public
│       ├── src
│       │   ├── config
│       │   ├── features
│       │   │   ├── game
│       │   │   ├── home
│       │   │   ├── landing
│       │   │   ├── leaderboard
│       │   │   ├── matchmaking
│       │   │   ├── modes
│       │   │   ├── profile
│       │   │   └── rooms
│       │   ├── services
│       │   └── utils
│       └── ...
├── infra
│   ├── docker
│   │   └── docker-compose.yml
│   └── nginx
│       └── nginx.conf
└── README.md
```

---

## Architecture Overview

### High-Level Flow

```
React Client
   ↓ WebSocket + RPC (wss://xo-xo-nakama-production.up.railway.app:443)
Nakama Server (Authoritative Match Handler) — Railway
   ↓
PostgreSQL — Railway (internal network)
   ↓
Storage (profiles, matches, rooms, history, analytics)
```

---

## Setup & Installation

### Prerequisites

- Node.js 18+
- Docker / Docker Compose

### Local Development

**1. Start Backend (Postgres + Nakama)**

```bash
cd infra/docker
docker-compose up
```

**2. Run Frontend**

```bash
cd apps/web
npm install
npm run dev
```

The frontend config auto-detects environment — no changes needed for local development:

```ts
// apps/web/src/config/index.ts
const config = {
  nakama: {
    host: import.meta.env.VITE_NAKAMA_HOST || window.location.hostname,
    port: import.meta.env.VITE_NAKAMA_PORT || "7350",
    ssl: import.meta.env.VITE_NAKAMA_SSL === "true" || false,
  },
};
```

Locally it falls back to `window.location.hostname:7350` with no SSL. No `.env` file or code changes required.

---

## Deployment

### Backend — Railway

The Nakama service is deployed on Railway with PostgreSQL as an internal dependency.

**`apps/server/nakama/Dockerfile`**

```dockerfile
FROM heroiclabs/nakama:3.22.0
COPY modules/ /nakama/data/modules/
```

**`apps/server/nakama/railway.toml`**

```toml
[deploy]
startCommand = "/bin/sh -ecx 'until /nakama/nakama migrate up --database.address $DATABASE_URL; do sleep 2; done && exec /nakama/nakama --name nakama1 --database.address $DATABASE_URL --logger.level INFO --console.username admin --console.password $CONSOLE_PASSWORD --runtime.js_entrypoint matches/xoxo.js'"
```

**Environment variables set in Railway:**

| Variable           | Value                                          |
| ------------------ | ---------------------------------------------- |
| `DATABASE_URL`     | Set automatically by Railway PostgreSQL plugin |
| `CONSOLE_PASSWORD` | Set in Railway service variables               |

**Port exposure:** Nakama API is exposed on port `7350`, mapped to `443` via Railway's generated domain.

**Redeploy:** Push to `main` — Railway auto-deploys on every commit.

---

### Frontend — Cloudflare Pages

**Build settings:**

| Setting          | Value           |
| ---------------- | --------------- |
| Root directory   | `apps/web`      |
| Build command    | `npm run build` |
| Output directory | `dist`          |

**Environment variables set in Cloudflare Pages:**

| Variable           | Value                                    |
| ------------------ | ---------------------------------------- |
| `VITE_NAKAMA_HOST` | `xo-xo-nakama-production.up.railway.app` |
| `VITE_NAKAMA_PORT` | `443`                                    |
| `VITE_NAKAMA_SSL`  | `true`                                   |

**PWA:** App is installable on mobile via browser "Add to Home Screen" — manifest, service worker, and install prompt included.
**Offline support:** Service worker pre-caches all static assets (SVGs, icons, JS, CSS) on first load. Local pass-and-play mode is fully available offline. Online modes (matchmaking, rooms, leaderboard) are gracefully disabled when no connection is detected.
**Redeploy:** Push to `main` — Cloudflare Pages auto-deploys on every commit.

---

## Core Design Decisions

### 1. Server-Authoritative Gameplay

All match logic runs on Nakama (`matches/xoxo.js`). The client sends minimal intents:

```json
{ "index": number }
```

or control actions (knock / accept / decline / close). The server validates turn ownership, cell availability, payload shape, and end-state transitions. This guarantees a strong anti-cheat baseline, a single source of truth across reconnects, and predictable outcomes.

### 2. Match Modes and Lifecycle

Two authoritative entry paths:

**Matchmaker flow** — client enters queue, Nakama pairs 2 players, match starts immediately when both join.

**Room flow** — host creates public/private room, joiner browses or enters room code, joiner sends knock, host accepts/declines, accepted knock starts game.

Lifecycle ownership remains server-side for board state, turn switching, timer and timeout resolution, winner/draw decision, and persistent storage writes.

### 3. Timer System (Server-Side)

Turn duration is 30 seconds. The server tracks `state.turnStartTime`. On timeout the active player loses, the opponent is declared winner, and the result is persisted with end reason `"timeout"`. The client only renders the countdown — it does not enforce timeout outcomes.

### 4. Rating Model

- Starting rating: **800**
- Provisional phase (first 3 games): Win +30 / Loss −15 / Draw ±0
- Stable phase: Win +10 / Loss −5 / Draw ±0
- Rating floor: 0
- Leaderboard eligibility: 3+ games played

---

## Data Storage

#### Profile (`profile/data`)

```json
{
  "username": "PLAYER_01",
  "wins": 0,
  "losses": 0,
  "draws": 0,
  "rating": 800,
  "winStreak": 0,
  "bestStreak": 0,
  "gamesPlayed": 0
}
```

#### Match Record (`matches/{matchId}`)

```json
{
  "matchId": "...",
  "gameMode": "matchmaker",
  "players": [{ "userId": "...", "symbol": "X", "username": "P1" }],
  "moves": [0, 4, 1, 3],
  "winner": "X",
  "endReason": "win",
  "openingCell": 0,
  "createdAt": 1710000000000
}
```

#### Room Mapping

- `rooms/{roomCode}` — forward lookup (roomCode → matchId)
- `room_index/{matchId}` — reverse metadata for public room listing

---

## API / Communication

### Client → Server (match state opCodes)

| OpCode | Purpose                                           |
| ------ | ------------------------------------------------- |
| `1`    | Gameplay payload (`{ index }`) / resync / forfeit |
| `2`    | Knock request                                     |
| `3`    | Host accept/decline knock                         |
| `4`    | Host close room                                   |

### Client → Server (RPC)

- `xo_create_room` — create public/private room, returns `matchId + roomCode`
- `xo_join_by_code` — resolve code to live match with capacity checks
- `xo_list_public_rooms` — return only waiting public rooms (server-filtered)

### Server → Client broadcast shape

```json
{
  "board": [],
  "players": [],
  "phase": "waiting | knocking | active | declined | expired",
  "turn": "...",
  "winner": null,
  "moves": []
}
```

---

## Testing Multiplayer

### Against the Live Deployment

Open [https://xo-xo-nakama.ranasushil026.workers.dev/](https://xo-xo-nakama.ranasushil026.workers.dev/) in two browser windows (one normal, one incognito) and test both flows.

### Local

```bash
# Terminal 1
cd infra/docker && docker-compose up

# Terminal 2
cd apps/web && npm run dev
```

Open `http://localhost:5173` in two browser windows.

### Expected Behaviour

- Matchmaker pairs two players automatically
- Room browser shows only waiting public rooms
- Private rooms are joinable by code only
- Knock / accept / decline behaves consistently
- Moves sync in real-time
- Turn restriction is enforced server-side
- Timeout produces an authoritative winner
- Match result is persisted and appears in history and profile
- Leaderboards update after the eligibility threshold (3 games)

---

## AI-Assisted Development

This project was developed with AI-assisted tooling:

- **Cursor** — implementation and refactoring workflows
- **ChatGPT** — architecture, debugging, and systems reasoning
- **Claude** — flow structuring and iteration support

AI was used as an accelerator while keeping implementation decisions and validation under manual engineering control.

---

## Upcoming

- AI opponent (adaptive, non-deterministic behaviour)
- Friend system / direct challenges
- Custom room policies (timeouts, rematch toggles, variants)
- Deeper analytics dashboards (openings, conversion, trend overlays)
- Improved host-room persistence when leaving room screen

---

## Summary

This project demonstrates:

- Real-time multiplayer systems design
- Server-authoritative game architecture
- Production-style match and room lifecycle handling
- Persisted competitive progression (rating + leaderboard)
- Structured, scalable frontend feature architecture
