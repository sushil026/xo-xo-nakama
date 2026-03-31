# XO Multiplayer — Nakama Server-Authoritative Game

A real-time multiplayer Tic-Tac-Toe game built with a **server-authoritative Nakama backend**, focused on fairness, reliability, and a clean full-stack architecture.

---

## Features

* Real-time online gameplay over WebSockets
* Server-authoritative game logic (validated moves, no client trust)
* Auto-matchmaking (2-player pairing)
* Public/private room system with shareable room codes
* Host knock-and-accept flow for room entry control
* Server-side turn timer enforcement (30s per move)
* Forfeit, timeout, draw, and standard win handling
* Persistent profiles (rating, streaks, games played)
* Match history with detailed move sequence and mini-board replay
* Dual leaderboards: **All-time** and **Monthly (resets on the 1st)**
* Profile analytics (opening heatmap, activity heatmap, rating progression)
* Reconnect-safe state resync
* Local pass-and-play mode
* Mobile-friendly, tactical UI style

---

## Project Structure

```
.
├── apps
│   ├── server
│   │   └── nakama
│   │       └── modules
│   │           └── match_handler.js
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
   ↓ WebSocket + RPC
Nakama Server (Authoritative Match Handler)
   ↓
Storage (profiles, matches, rooms, history, analytics)
```

---

## Core Design Decisions

### 1. Server-Authoritative Gameplay

* All match logic runs on Nakama (`match_handler.js`)
* Client sends minimal intents:

  ```json
  { "index": number }
  ```

  or control actions (knock/accept/decline/close)
* Server validates:

  * Turn ownership
  * Cell availability
  * Payload shape and legality
  * End-state transitions

This guarantees:

* Strong anti-cheat baseline
* Single source of truth for all clients
* Predictable outcomes across reconnects

---

### 2. Match Modes and Lifecycle

Two authoritative entry paths:

1. **Matchmaker flow**

   * Client enters queue
   * Nakama pairs 2 players
   * Match starts immediately when both join

2. **Room flow**

   * Host creates public/private room
   * Joiner browses or enters room code
   * Joiner sends knock
   * Host accepts/declines
   * Accepted knock starts game

Lifecycle ownership remains server-side for:

* Board state
* Turn switching
* Timer and timeout resolution
* Winner/draw decision
* Persistent storage writes

---

### 3. Timer System (Server-Side)

* Turn duration: **30 seconds**
* Server tracks `state.turnStartTime`
* On timeout:

  * Active player loses by timeout
  * Opponent is declared winner
  * Result is persisted with end reason

Client only renders countdown; it does not enforce timeout outcomes.

---

### 4. Rating Model and Competitive Gate

* Starting rating: **800**
* Provisional phase: first **3 games**

  * Win: +30
  * Loss: -15
  * Draw: +/-0
* Stable phase (post-provisional):

  * Win: +10
  * Loss: -5
  * Draw: +/-0
* Rating floor: 0
* Leaderboard eligibility threshold: 3+ games played

---

### 5. Data Storage

#### Profile (`profile` / `data`)

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

#### Match Record (`matches` / `{matchId}`)

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

#### User Match History (`user_matches` / `list`)

```json
{
  "matches": ["latestMatchId", "olderMatchId"]
}
```

#### Room Mapping

* `rooms/{roomCode}` → forward lookup (`roomCode -> matchId`)
* `room_index/{matchId}` → reverse metadata for public room listing

#### Client Analytics (`analytics` / `data`)

```json
{
  "openingStats": [[0, 0, 0], "...9 cells total"],
  "cellHeatmap": [[0, 0, 0], "...9 cells total"],
  "totalMoves": 0,
  "avgMovesPerGame": 0,
  "timeoutLosses": 0,
  "forfeitLosses": 0,
  "gamesPlayed": 0
}
```

---

## Frontend Structure

### Screens

* `LandingScreen` — device init and username setup
* `HomeScreen` — quick stats and navigation hub
* `ModesScreen` — game mode entry
* `MatchmakingScreen` — queue and auto-pair flow
* `RoomScreen` — create/browse/join-by-code room system
* `OnlineGameScreen` — authoritative multiplayer board
* `ProfileScreen` — profile, analytics, rating progression
* `MatchHistoryScreen` — detailed recent match history
* `LeaderboardScreen` — monthly/all-time rankings

### Core Modules

#### `useGame.ts`

* Socket lifecycle
* Match join/create logic
* Sending moves and handling server state
* Reconnect and resync behavior

#### `nakamaClient.ts`

* Device authentication + session bootstrap
* Shared socket reuse
* Profile/history/leaderboard/room service functions
* RPC wrappers for room creation, join-by-code, and public-room listing

---

## Server (Nakama)

### Match Handler (`match_handler.js`)

Responsible for:

* Match init and labels (`waiting_public`, `waiting_private`, `active`)
* Join/rejoin enforcement
* Knock flow + host response flow
* Move validation and turn switching
* Timeout / forfeit / draw / win finalization
* Match persistence and profile/rating updates
* Room record lifecycle (create/delete)
* Leaderboard record updates

### Registered RPCs

* `xo_create_room` — create public/private room and return `matchId + roomCode`
* `xo_join_by_code` — resolve code to live match with capacity checks
* `xo_list_public_rooms` — return only waiting public rooms (server-filtered)

### Matchmaker

```ts
socket.addMatchmaker("*", 2, 2);
```

* Automatically pairs exactly 2 players
* Creates authoritative match via `matchmakerMatched`

---

## API / Communication

### Client → Server (match state opCodes)

* `1` — standard gameplay payload (`{ index }` / resync / forfeit)
* `2` — knock request
* `3` — host accept/decline knock
* `4` — host close room

### Client → Server (RPC)

* `xo_create_room`
* `xo_join_by_code`
* `xo_list_public_rooms`

### Server → Client

State broadcast includes (shape abbreviated):

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

## Setup & Installation

### Prerequisites

* Node.js
* Docker / Docker Compose

### Start Backend (Postgres + Nakama)

```bash
cd infra/docker
docker-compose up
```

### Run Frontend

```bash
cd apps/web
npm install
npm run dev
```

### Local Configuration

Current web config points to host machine on port `7350`:

```ts
const config = {
  nakama: {
    host: window.location.hostname,
    port: "7350",
    ssl: false
  }
};
```

---

## Testing Multiplayer

### Same Machine

* Open one normal browser window and one incognito window
* Test both:

  * Matchmaker flow (quick online match)
  * Room flow (create room, join by code, knock acceptance)

### Expected Behavior

* Matchmaker pairs two players
* Room browser shows only waiting public rooms
* Private rooms are joinable by code only
* Knock/accept/decline behaves consistently
* Moves sync in real-time
* Turn restriction is enforced server-side
* Timeout produces authoritative winner
* Match result is persisted and appears in history/profile
* Leaderboards update after eligibility threshold

---

## Design Approach

* Minimal tactical UI with strong information hierarchy
* Emphasis on quick state readability and low visual noise
* Separation of concerns across UI, transport, and authoritative game logic
* Operational observability through structured server log prefixes

---

## AI-Assisted Development

This project was developed with AI-assisted tooling:

* Cursor — implementation and refactoring workflows
* ChatGPT — architecture, debugging, and systems reasoning
* Claude — flow structuring and iteration support

AI was used as an accelerator while keeping implementation decisions and validation under manual engineering control.

---

## Upcoming

* AI opponent (adaptive, non-deterministic behavior)
* Friend system / direct challenges
* Custom room policies (timeouts, rematch toggles, variants)
* Deeper analytics dashboards (openings, conversion, trend overlays)
* Improved host-room persistence when leaving room screen

---

## Summary

This project demonstrates:

* Real-time multiplayer systems design
* Server-authoritative game architecture
* Production-style match and room lifecycle handling
* Persisted competitive progression (rating + leaderboard)
* Structured, scalable frontend feature architecture

---