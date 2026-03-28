# XO Multiplayer — Nakama Server-Authoritative Game

A real-time multiplayer Tic-Tac-Toe game built using a **server-authoritative architecture with Nakama**, focusing on consistency, fairness, and clean system design.

---

## Features

* Real-time multiplayer gameplay (WebSocket-based)
* Server-authoritative game logic (validated moves, no client trust)
* Automatic matchmaking (2-player pairing)
* Turn-based gameplay with **server-side timer enforcement**
* Match result storage and player profile updates
* Reconnect handling with state resync
* Local (pass-and-play) mode
* Modular frontend architecture using React + hooks
* Mobile-friendly responsive UI

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
│       │   │   ├── matchmaking
│       │   │   └── modes
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
   ↓ WebSocket
Nakama Server (Match Handler)
   ↓
Storage (Profiles, Matches)
```

---

## Core Design Decisions

### 1. Server-Authoritative Gameplay

* All game logic runs on the Nakama server
* Client only sends:

  ```
  { index: number }
  ```
* Server validates:

  * Turn ownership
  * Cell availability
  * Game rules

This ensures:

* No client-side cheating
* Consistent state across players

---

### 2. Match Lifecycle

1. Client connects using device ID
2. Player enters matchmaking queue
3. Nakama pairs players
4. Match is created and joined
5. Server controls:

   * Board state
   * Turn switching
   * Timer
   * Winner

---

### 3. Timer System (Server-Side)

* Each turn has a fixed duration (30 seconds)
* Server tracks:

  ```
  state.turnStartTime
  ```
* If exceeded:

  * Current player loses
  * Opponent wins automatically

Client:

* Displays countdown
* Does not enforce timeout

---

### 4. Data Storage

#### Profile (`profile` collection)

```json
{
  "wins": 0,
  "losses": 0,
  "draws": 0,
  "rating": 1200
}
```

---

#### Match Data (`matches` collection)

```json
{
  "matchId": "...",
  "players": [...],
  "moves": [0,4,1],
  "winner": "X"
}
```

---

#### User Match History (`user_matches`)

```json
{
  "matches": ["match1", "match2"]
}
```

---

## Frontend Structure

### Screens

* `LandingScreen` — device init, username selection
* `HomeScreen` — quick stats and navigation
* `ModesScreen` — game mode selection
* `MatchmakingScreen` — queue and match finding
* `OnlineGameScreen` — multiplayer gameplay
* `LocalGame` — offline pass-and-play

---

### Core Modules

#### `useGame.ts`

* Socket connection
* Match join/create
* Sending moves
* Receiving game state

#### `nakamaClient.ts`

* Connection handling
* Session management
* Socket reuse

---

## Server (Nakama)

### Match Handler (`match_handler.js`)

Handles:

* Match initialization
* Player join/leave
* Move validation
* Turn management
* Timer enforcement
* Match result storage
* Profile updates

---

### Matchmaker

```ts
socket.addMatchmaker("*", 2, 2);
```

* Automatically pairs 2 players
* Creates match via `matchmakerMatched`

---

## API / Communication

### Client → Server

```json
{ "index": number }
```

---

### Server → Client

Full state broadcast:

```json
{
  "board": [],
  "players": [],
  "turn": "...",
  "winner": null
}
```

---

## Setup & Installation

### Prerequisites

* Node.js
* Docker

---

### Start Nakama

```bash
docker-compose up
```

---

### Run Frontend

```bash
cd apps/web
npm install
npm run dev
```

---

### Configuration

```ts
new Client("defaultkey", "127.0.0.1", "7350", false);
```

---

## Testing Multiplayer

### Same Machine

* Open:

  * One normal tab
  * One incognito tab
* Start matchmaking on both

---

### Expected Behavior

* Players get matched automatically
* Moves sync in real-time
* Turn restriction enforced
* Timer triggers server-side win
* Reconnect restores state

---

## Design Approach

* Minimal, tactical UI inspired by structured layouts
* Emphasis on readability and quick state recognition
* Clean separation between UI and logic

---

## AI-Assisted Development

This project was built using AI-assisted tooling:

* Cursor — development and refactoring
* ChatGPT — system design, debugging, architecture decisions
* Claude — reasoning and structuring flows

AI was used as a development accelerator while maintaining manual control over logic and implementation.

---

## Upcoming

* AI opponent (adaptive and non-deterministic gameplay)
* Leaderboard system
* Match analytics (openings, win rates, heatmaps)
* Custom room creation and joining

---

## Summary

This project demonstrates:

* Real-time multiplayer systems
* Server-authoritative game design
* Scalable match handling
* Structured frontend architecture

---