/**
 * match_handler.js — Authoritative XO match handler for Nakama (JavaScript runtime)
 *
 * Logger color-coding convention (filter by prefix in Nakama log viewer):
 *   [XO:INIT]  — teal   — Match lifecycle: born, params parsed, label set, module loaded
 *   [XO:JOIN]  — blue   — Player join/attempt: symbol assigned, full-lobby detection, label→active
 *   [XO:MOVE]  — purple — In-game actions: cell placed, board state, winner/draw detected
 *   [XO:END]   — amber  — Game over: timeout awarded, forfeit triggered, end reason recorded
 *   [XO:STORE] — coral  — Storage writes: profile, match record, user_matches, rating delta
 *   [XO:ROOM]  — green  — Room CRUD: code created, record written/deleted, visibility flag
 *   [XO:RPC]   — pink   — RPC entry/exit: caller, payload summary, matchId / error returned
 *   [XO:LB]    — gray   — Leaderboard: submit attempt, threshold check, failure
 *   [XO:WARN]  — red    — All warnings/errors: catch blocks, rejected joins, bad payloads
 *
 * Match label convention (drives listMatches filtering):
 *   "waiting_public"   — 1 player in, publicly listed in room browser
 *   "waiting_private"  — 1 player in, NOT listed (code/link only)
 *   "active"           — 2 players in, game running (removed from browser)
 *   "tic-tac-toe"      — legacy auto-matchmaker matches
 *
 * Storage collections:
 *   matches/{matchId}        public read, server write — final match record
 *   user_matches/list        private — per-user match id list
 *   profile/data             public read — stats, rating
 *   rooms/{roomCode}         public read, server write — code→matchId lookup
 */

var WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

var PROVISIONAL_GAMES = 3;
var RATING_WIN_EARLY = 30;
var RATING_LOSS_EARLY = 15;
var RATING_WIN_STABLE = 10;
var RATING_LOSS_STABLE = 5;
var RATING_FLOOR = 0;
var RATING_START = 800;
var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

//  Pure helpers

function checkWinner(board) {
  for (var i = 0; i < WIN_LINES.length; i++) {
    var a = WIN_LINES[i][0],
      b = WIN_LINES[i][1],
      c = WIN_LINES[i][2];
    if (board[a] && board[a] === board[b] && board[a] === board[c])
      return board[a];
  }
  return null;
}

function broadcast(nk, dispatcher, state, presences) {
  dispatcher.broadcastMessage(
    1,
    nk.stringToBinary(JSON.stringify(state)),
    presences || null,
    null,
    true,
  );
}

function generateRoomCode() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  var code = "";
  for (var i = 0; i < 6; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

//  Leaderboard

function submitLeaderboard(
  nk,
  logger,
  userId,
  username,
  wins,
  rating,
  gamesPlayed,
) {
  // [XO:LB] Threshold check — skips submit if player has fewer than 5 games
  if (gamesPlayed < 5) {
    logger.info(
      "[XO:LB] Skipping leaderboard submit for " +
        userId.slice(0, 8) +
        " — only " +
        gamesPlayed +
        " game(s) played (threshold: 5)",
    );
    return;
  }

  var name = username || "";

  // [XO:LB] Writing all-time leaderboard record — score=wins, subscore=rating
  try {
    nk.leaderboardRecordWrite("xo_alltime", userId, name, wins, rating, {});
    logger.info(
      "[XO:LB] xo_alltime updated for " +
        userId.slice(0, 8) +
        " wins=" +
        wins +
        " rating=" +
        rating,
    );
  } catch (e) {
    // [XO:WARN] xo_alltime write failed — leaderboard may be missing or misconfigured
    logger.warn(
      "[XO:WARN] xo_alltime write failed for " + userId.slice(0, 8) + ": " + e,
    );
  }

  // [XO:LB] Writing monthly leaderboard record — resets on cron "0 0 1 * *"
  try {
    nk.leaderboardRecordWrite("xo_monthly", userId, name, wins, rating, {});
    logger.info(
      "[XO:LB] xo_monthly updated for " +
        userId.slice(0, 8) +
        " wins=" +
        wins +
        " rating=" +
        rating,
    );
  } catch (e) {
    // [XO:WARN] xo_monthly write failed — leaderboard may be missing or misconfigured
    logger.warn(
      "[XO:WARN] xo_monthly write failed for " + userId.slice(0, 8) + ": " + e,
    );
  }
}

//  Storage helpers

function defaultProfile(username) {
  return {
    username: username || null,
    wins: 0,
    losses: 0,
    draws: 0,
    rating: RATING_START,
    winStreak: 0,
    bestStreak: 0,
    gamesPlayed: 0,
  };
}

function applyRatingDelta(rating, gamesBefore, won, drew) {
  if (drew) return rating;
  var early = gamesBefore < PROVISIONAL_GAMES;
  if (won) return rating + (early ? RATING_WIN_EARLY : RATING_WIN_STABLE);
  return Math.max(
    RATING_FLOOR,
    rating - (early ? RATING_LOSS_EARLY : RATING_LOSS_STABLE),
  );
}

/**
 * [XO:ROOM] Write rooms/{roomCode} + room_index/{matchId} under SYSTEM_USER_ID.
 * rooms/{roomCode}     -- code->matchId forward lookup (used by rpcJoinByCode)
 * room_index/{matchId} -- matchId->room metadata reverse lookup (used by rpcListPublicRooms)
 * Both records are deleted together when the room is torn down.
 */
function writeRoomRecord(nk, logger, roomCode, matchId, hostUserId, isPublic) {
  // Resolve host display username so browse list shows "X's room" without extra RPC
  var hostUsername = null;
  try {
    var pr = nk.storageRead([
      { collection: "profile", key: "data", userId: hostUserId },
    ]);
    if (pr.length > 0 && pr[0].value.username) {
      hostUsername = pr[0].value.username;
    }
  } catch (_) {
    // non-fatal -- browse falls back to userId slice
  }

  var createdAt = Date.now();

  try {
    nk.storageWrite([
      // Forward lookup: code -> matchId
      {
        collection: "rooms",
        key: roomCode,
        userId: SYSTEM_USER_ID,
        value: {
          matchId: matchId,
          hostUserId: hostUserId,
          isPublic: isPublic,
          createdAt: createdAt,
        },
        permissionRead: 2,
        permissionWrite: 0,
      },
      // Reverse lookup: matchId -> full room metadata (for rpcListPublicRooms)
      {
        collection: "room_index",
        key: matchId,
        userId: SYSTEM_USER_ID,
        value: {
          roomCode: roomCode,
          hostUserId: hostUserId,
          hostUsername: hostUsername,
          isPublic: isPublic,
          createdAt: createdAt,
        },
        permissionRead: 2,
        permissionWrite: 0,
      },
    ]);
    // [XO:ROOM] Both records written -- forward (code->match) + reverse (match->meta)
    logger.info(
      "[XO:ROOM] Written code=" +
        roomCode +
        " matchId=" +
        matchId.slice(0, 8) +
        " host=" +
        hostUserId.slice(0, 8) +
        " (" +
        (hostUsername || "no-username") +
        ")" +
        " public=" +
        isPublic,
    );
  } catch (e) {
    // [XO:WARN] storageWrite failed -- join-by-code will return not_found for this room
    logger.warn("[XO:WARN] writeRoomRecord failed code=" + roomCode + ": " + e);
  }
}

/**
 * [XO:ROOM] Delete rooms/{roomCode} — called when second player joins or match ends.
 * Consecutive actions: storageDelete → log success or warn on failure.
 */
function deleteRoomRecord(nk, logger, roomCode, matchId) {
  if (!roomCode) return;
  var toDelete = [
    { collection: "rooms", key: roomCode, userId: SYSTEM_USER_ID },
  ];
  // Also remove the reverse-lookup index if matchId is provided
  if (matchId) {
    toDelete.push({
      collection: "room_index",
      key: matchId,
      userId: SYSTEM_USER_ID,
    });
  }
  try {
    nk.storageDelete(toDelete);
    // [XO:ROOM] Room records deleted -- code + index no longer resolve
    logger.info(
      "[XO:ROOM] Deleted code=" +
        roomCode +
        (matchId ? " matchId=" + matchId.slice(0, 8) : ""),
    );
  } catch (e) {
    // [XO:WARN] storageDelete failed -- stale room record may linger until match terminates
    logger.warn(
      "[XO:WARN] deleteRoomRecord failed code=" + roomCode + ": " + e,
    );
  }
}

/**
 * [XO:STORE] Persist final match outcome for both players.
 * Consecutive actions per player:
 *   1. deleteRoomRecord (room cleanup)
 *   2. storageWrite matches/{matchId} (canonical match record)
 *   3. storageRead + storageWrite user_matches/list (append matchId to history)
 *   4. storageRead profile/data (or create default)
 *   5. Apply win/loss/draw counters + rating delta
 *   6. storageWrite profile/data
 *   7. submitLeaderboard (threshold-gated)
 */
function saveMatchResult(ctx, nk, logger, state, endReason) {
  // [XO:ROOM] Cleaning up room record before persisting result
  deleteRoomRecord(nk, logger, state.roomCode || null, state.matchId || null);

  // [XO:STORE] Writing canonical match record — winner, moves, end reason
  try {
    nk.storageWrite([
      {
        collection: "matches",
        key: state.matchId,
        value: {
          matchId: state.matchId,
          gameMode: state.gameMode,
          players: state.players.map(function (p) {
            return {
              userId: p.userId,
              symbol: p.symbol,
              username: p.username || null,
            };
          }),
          moves: state.moves,
          winner: state.winner,
          endReason: endReason,
          openingCell: state.moves.length > 0 ? state.moves[0] : null,
          createdAt: Date.now(),
        },
        permissionRead: 2,
        permissionWrite: 0,
      },
    ]);
    logger.info(
      "[XO:STORE] Match record saved matchId=" +
        state.matchId.slice(0, 8) +
        " winner=" +
        state.winner +
        " reason=" +
        endReason +
        " moves=" +
        state.moves.length,
    );
  } catch (e) {
    // [XO:WARN] Match record write failed — result will not appear in match history
    logger.warn(
      "[XO:WARN] Match record write failed matchId=" +
        state.matchId.slice(0, 8) +
        ": " +
        e,
    );
  }

  for (var i = 0; i < state.players.length; i++) {
    var player = state.players[i];
    var uid = player.userId;
    var won = state.winner !== "draw" && state.winner === player.symbol;
    var drew = state.winner === "draw";

    // [XO:STORE] Reading user_matches/list to prepend new matchId
    var history = [];
    try {
      var r = nk.storageRead([
        { collection: "user_matches", key: "list", userId: uid },
      ]);
      if (r.length > 0) history = r[0].value.matches || [];
    } catch (_) {
      // [XO:WARN] user_matches read failed — starting fresh history for this player
      logger.warn(
        "[XO:WARN] user_matches read failed for " +
          uid.slice(0, 8) +
          " — using empty list",
      );
    }

    history.unshift(state.matchId);
    if (history.length > 200) history = history.slice(0, 200);

    // [XO:STORE] Writing updated match history list (capped at 200 entries)
    try {
      nk.storageWrite([
        {
          collection: "user_matches",
          key: "list",
          userId: uid,
          value: { matches: history },
          permissionRead: 1,
          permissionWrite: 1,
        },
      ]);
      logger.info(
        "[XO:STORE] user_matches updated for " +
          uid.slice(0, 8) +
          " total=" +
          history.length,
      );
    } catch (_) {
      // [XO:WARN] user_matches write failed — match won't appear in player's history
      logger.warn("[XO:WARN] user_matches write failed for " + uid.slice(0, 8));
    }

    // [XO:STORE] Reading profile to apply stats + rating delta
    var profile;
    try {
      var pr = nk.storageRead([
        { collection: "profile", key: "data", userId: uid },
      ]);
      profile =
        pr.length > 0 ? pr[0].value : defaultProfile(player.username || null);
      if (pr.length === 0) {
        logger.info(
          "[XO:STORE] No existing profile for " +
            uid.slice(0, 8) +
            " — initialising default (rating=" +
            RATING_START +
            ")",
        );
      }
    } catch (_) {
      // [XO:WARN] Profile read failed — using default to avoid blocking stat update
      logger.warn(
        "[XO:WARN] Profile read failed for " +
          uid.slice(0, 8) +
          " — using default",
      );
      profile = defaultProfile(player.username || null);
    }

    if (typeof profile.gamesPlayed !== "number")
      profile.gamesPlayed = profile.wins + profile.losses + profile.draws;
    if (typeof profile.rating !== "number") profile.rating = RATING_START;

    var before = profile.gamesPlayed;
    var prevRating = profile.rating;

    if (drew) {
      profile.draws = (profile.draws || 0) + 1;
      profile.winStreak = 0;
    } else if (won) {
      profile.wins = (profile.wins || 0) + 1;
      profile.winStreak = (profile.winStreak || 0) + 1;
      profile.bestStreak = Math.max(profile.bestStreak || 0, profile.winStreak);
    } else {
      profile.losses = (profile.losses || 0) + 1;
      profile.winStreak = 0;
    }

    profile.rating = applyRatingDelta(profile.rating, before, won, drew);
    profile.gamesPlayed = before + 1;

    // [XO:STORE] Writing updated profile — new rating, streak, win/loss/draw count
    try {
      nk.storageWrite([
        {
          collection: "profile",
          key: "data",
          userId: uid,
          value: profile,
          permissionRead: 2,
          permissionWrite: 1,
        },
      ]);
      logger.info(
        "[XO:STORE] Profile updated " +
          uid.slice(0, 8) +
          " outcome=" +
          (drew ? "draw" : won ? "win" : "loss") +
          " rating=" +
          prevRating +
          "→" +
          profile.rating +
          " streak=" +
          profile.winStreak +
          " gamesPlayed=" +
          profile.gamesPlayed,
      );
    } catch (_) {
      // [XO:WARN] Profile write failed — stats not persisted for this player this game
      logger.warn("[XO:WARN] Profile write failed for " + uid.slice(0, 8));
    }

    submitLeaderboard(
      nk,
      logger,
      uid,
      profile.username || null,
      profile.wins || 0,
      profile.rating,
      profile.gamesPlayed,
    );
  }
}

//  Match lifecycle

function matchInit(ctx, logger, nk, params) {
  var isRoom =
    params && (params.isPublic === "true" || params.isPublic === "false");
  var isPublic = params && params.isPublic === "true";
  var roomCode = params && params.roomCode ? params.roomCode : null;
  var hostUserId = params && params.hostUserId ? params.hostUserId : null;

  var label = isRoom
    ? isPublic
      ? "waiting_public"
      : "waiting_private"
    : "tic-tac-toe";

  // [XO:INIT] Match created — params parsed, initial label set, state zeroed
  logger.info(
    "[XO:INIT] matchInit matchId=" +
      ctx.matchId.slice(0, 8) +
      " label=" +
      label +
      " isRoom=" +
      isRoom +
      " isPublic=" +
      isPublic +
      (roomCode ? " roomCode=" + roomCode : "") +
      (hostUserId ? " host=" + hostUserId.slice(0, 8) : ""),
  );

  if (roomCode && hostUserId) {
    // [XO:ROOM] Writing room record immediately after matchInit so join-by-code resolves
    writeRoomRecord(nk, logger, roomCode, ctx.matchId, hostUserId, isPublic);
  }

  return {
    state: {
      board: Array(9).fill(null),
      players: [],
      phase: "waiting",
      knockerName: null,
      expiresAt: Date.now() + 900000, // 15 min
      gameMode: params?.gameMode || "matchmaker",
      hostUserId: hostUserId,
      joinerPresence: null,
      turn: null,
      winner: null,
      moves: [],
      matchId: ctx.matchId,
      turnStartTime: Date.now(),
      roomCode: roomCode,
      isPublic: isPublic,
      label: label,
    },
    tickRate: 1,
    label: label,
  };
}

function matchJoinAttempt(
  ctx,
  logger,
  nk,
  dispatcher,
  tick,
  state,
  presence,
  metadata,
) {
  logger.info(
    "[XO:JOIN] matchJoinAttempt phase=" +
      state.phase +
      " players=" +
      state.players.length +
      " user=" +
      presence.userId.slice(0, 8),
  );

  // 1. Rejoin — always allow
  for (var i = 0; i < state.players.length; i++) {
    if (state.players[i].userId === presence.userId) {
      logger.info(
        "[XO:JOIN] Rejoin accepted user=" +
          presence.userId.slice(0, 8) +
          " matchId=" +
          ctx.matchId.slice(0, 8),
      );
      return { state: state, accept: true };
    }
  }

  // 2. Block join if room is not in waiting phase
  if (state.phase && state.phase !== "waiting") {
    logger.info(
      "[XO:JOIN] Rejected (phase=" +
        state.phase +
        ") user=" +
        presence.userId.slice(0, 8) +
        " matchId=" +
        ctx.matchId.slice(0, 8),
    );
    return {
      state: state,
      accept: false,
      rejectMessage: "Room not accepting players",
    };
  }

  // 3. Block if already 2 players
  if (state.players.length >= 2) {
    logger.info(
      "[XO:JOIN] Rejected (full) user=" +
        presence.userId.slice(0, 8) +
        " matchId=" +
        ctx.matchId.slice(0, 8),
    );
    return {
      state: state,
      accept: false,
      rejectMessage: "Match is full",
    };
  }

  // 4. Allow joiner presence (BUT do NOT start game)
  if (state.players.length === 1) {
    logger.info(
      "[XO:JOIN] Joiner accepted (awaiting knock) user=" +
        presence.userId.slice(0, 8) +
        " matchId=" +
        ctx.matchId.slice(0, 8),
    );

    // IMPORTANT:
    // - we accept presence
    // - but game will NOT start here
    // - client must send OP_KNOCK next

    return { state: state, accept: true };
  }

  // 5. First player (host)
  logger.info(
    "[XO:JOIN] Host joined user=" +
      presence.userId.slice(0, 8) +
      " matchId=" +
      ctx.matchId.slice(0, 8),
  );

  return { state: state, accept: true };
}

function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  logger.info(
    "[XO:JOIN] matchJoin called presences=" +
      presences.length +
      " current_players=" +
      state.players,
  );
  for (var i = 0; i < presences.length; i++) {
    var p = presences[i];
    var alreadyIn = false;
    for (var j = 0; j < state.players.length; j++) {
      if (state.players[j].userId === p.userId) {
        alreadyIn = true;
        break;
      }
    }
    if (!alreadyIn && state.players.length < 2) {
      state.players.push({
        userId: p.userId,
        symbol: state.players.length === 0 ? "X" : "O",
        username: p.username,
      });
      if (state.players.length === 2) {
        if (state.roomCode) {
          // room match — wait for knock
          state.joinerPresence = p;
          logger.info("[XO:JOIN] Joiner present — waiting for knock");
          broadcast(nk, dispatcher, state);
        } else {
          // matchmaker match — start immediately
          state.phase = "active";
          state.turn = state.players[0].userId;
          state.turnStartTime = Date.now();
          state.label = "active";
          dispatcher.matchLabelUpdate("active");
          logger.info("[XO:JOIN] Matchmaker game starting immediately");
          broadcast(nk, dispatcher, state);
        }
      }
      var assignedSymbol = state.players[state.players.length - 1].symbol;
      // [XO:JOIN] Player added to roster — symbol assigned, slot count updated
      logger.info(
        "[XO:JOIN] " +
          p.username +
          " (user=" +
          p.userId.slice(0, 8) +
          ") joined as " +
          assignedSymbol +
          " matchId=" +
          ctx.matchId.slice(0, 8) +
          " players=" +
          state.players.length +
          "/2",
      );
    }
  }

  return { state: state };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var i = 0; i < presences.length; i++) {
    // [XO:JOIN] Player disconnected — game continues; forfeit/timeout may follow
    logger.info(
      "[XO:JOIN] Player left user=" +
        presences[i].userId.slice(0, 8) +
        " matchId=" +
        ctx.matchId.slice(0, 8) +
        " winner=" +
        (state.winner || "none"),
    );
  }
  return { state: state };
}

function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  if (state.winner !== null) return { state: state };

  // EXPIRY CHECK
  if (
    state.players.length > 0 &&
    Date.now() > state.expiresAt &&
    state.phase !== "active"
  ) {
    state.phase = "expired";

    logger.info("[XO:END] Room expired matchId=" + ctx.matchId.slice(0, 8));

    broadcast(nk, dispatcher, state);
    return null;
  }

  // TURN TIMEOUT (ONLY DURING ACTIVE GAME)
  if (
    state.phase === "active" &&
    state.turn &&
    Date.now() - state.turnStartTime > 30000
  ) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].userId !== state.turn) {
        state.winner = state.players[i].symbol;
        state.turnStartTime = 0;

        logger.info(
          "[XO:END] Timeout: " +
            state.turn.slice(0, 8) +
            " ran out of time → winner=" +
            state.winner +
            " matchId=" +
            ctx.matchId.slice(0, 8),
        );

        try {
          saveMatchResult(ctx, nk, logger, state, "timeout");
        } catch (e) {
          logger.warn("[XO:WARN] saveMatchResult failed after timeout: " + e);
        }

        broadcast(nk, dispatcher, state);
        break;
      }
    }
    return { state: state };
  }

  // PROCESS MESSAGES
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var data;

    try {
      data = JSON.parse(nk.binaryToString(msg.data));
    } catch (_) {
      logger.warn(
        "[XO:WARN] Bad message payload from user=" +
          msg.sender.userId.slice(0, 8) +
          " matchId=" +
          ctx.matchId.slice(0, 8),
      );
      continue;
    }

    // KNOCK FLOW

    // OP_KNOCK (2)
    if (msg.opCode === 2) {
      if (state.phase !== "waiting") continue;

      var knockerName =
        data.knockerName ||
        msg.sender.username ||
        msg.sender.userId.slice(0, 8);

      state.phase = "knocking";
      state.knockerName = knockerName;

      logger.info(
        "[XO:KNOCK] Knock from " +
          knockerName +
          " matchId=" +
          ctx.matchId.slice(0, 8),
      );
      logger.info(
        "[XO:KNOCK] players[0].userId=" +
          state.players[0].userId +
          " hostUserId=" +
          state.hostUserId,
      );

      broadcast(nk, dispatcher, state);
      continue;
    }

    // OP_HOST_RESPONSE (3)
    if (msg.opCode === 3) {
      if (state.phase !== "knocking") continue;

      if (data.accept === true) {
        // ACCEPT
        state.phase = "active";
        state.knockerName = null;

        state.turn = state.players[0].userId;
        state.turnStartTime = Date.now();

        if (state.label !== "active") {
          state.label = "active";
          dispatcher.matchLabelUpdate("active");
          deleteRoomRecord(nk, logger, state.roomCode, ctx.matchId);
        }

        logger.info("[XO:KNOCK] Accepted → game starting");

        broadcast(nk, dispatcher, state);
        continue;
      } else {
        // DECLINE
        state.phase = "declined";
        state.knockerName = null;

        logger.info(
          "[XO:KNOCK] decline state.joinerPresence=" +
            JSON.stringify(state.joinerPresence),
        );
        logger.info("[XO:KNOCK] Declined");

        broadcast(nk, dispatcher, state);

        logger.info(
          "[XO:KNOCK] Decline broadcast complete: " +
            state.joinerPresence +
            " hostUserId=" +
            state.hostUserId,
        );

        state.joinerPresence = null;

        // RESET
        state.phase = "waiting";
        state.players = state.players.slice(0, 1);

        continue;
      }
    }

    // OP_CLOSE_ROOM (4)
    if (msg.opCode === 4) {
      state.phase = "expired";

      logger.info("[XO:ROOM] Closed by host");

      broadcast(nk, dispatcher, state);
      return null;
    }

    // EXISTING GAME LOGIC

    // Ignore gameplay if not active
    if (state.phase !== "active") continue;

    // Resync
    if (typeof data.index === "undefined" && !data.forfeit) {
      broadcast(nk, dispatcher, state, [msg.sender]);
      continue;
    }

    // Forfeit
    if (data.forfeit === true) {
      if (state.winner) continue;

      var wp = null;
      for (var j = 0; j < state.players.length; j++) {
        if (state.players[j].userId !== msg.sender.userId) {
          wp = state.players[j];
          break;
        }
      }
      if (!wp) continue;

      state.winner = wp.symbol;
      state.turnStartTime = 0;

      logger.info(
        "[XO:END] Forfeit by user=" +
          msg.sender.userId.slice(0, 8) +
          " → winner=" +
          state.winner,
      );

      try {
        saveMatchResult(ctx, nk, logger, state, "forfeit");
      } catch (e) {
        logger.warn("[XO:WARN] saveMatchResult failed after forfeit: " + e);
      }

      broadcast(nk, dispatcher, state);
      continue;
    }

    // Move
    if (state.winner || msg.sender.userId !== state.turn) continue;

    var idx = data.index;

    if (
      typeof idx !== "number" ||
      idx < 0 ||
      idx > 8 ||
      idx !== Math.floor(idx)
    )
      continue;

    if (state.board[idx] !== null) continue;

    var cp = null;
    for (var k = 0; k < state.players.length; k++) {
      if (state.players[k].userId === state.turn) {
        cp = state.players[k];
        break;
      }
    }
    if (!cp) continue;

    state.board[idx] = cp.symbol;
    state.moves.push(idx);

    var winner = checkWinner(state.board);

    if (winner) {
      state.winner = winner;
      state.turnStartTime = 0;
      saveMatchResult(ctx, nk, logger, state, "win");
    } else if (
      state.board.every(function (c) {
        return c !== null;
      })
    ) {
      state.winner = "draw";
      state.turnStartTime = 0;
      saveMatchResult(ctx, nk, logger, state, "draw");
    } else {
      for (var n = 0; n < state.players.length; n++) {
        if (state.players[n].userId !== state.turn) {
          state.turn = state.players[n].userId;
          break;
        }
      }
      state.turnStartTime = Date.now();
    }

    broadcast(nk, dispatcher, state);
    break;
  }

  return { state: state };
}

function matchTerminate(
  ctx,
  logger,
  nk,
  dispatcher,
  tick,
  state,
  graceSeconds,
) {
  // [XO:INIT] Match terminating — cleaning up room record if still present
  logger.info(
    "[XO:INIT] matchTerminate matchId=" +
      ctx.matchId.slice(0, 8) +
      " graceSeconds=" +
      graceSeconds +
      " winner=" +
      (state.winner || "none"),
  );
  deleteRoomRecord(nk, logger, state.roomCode || null, ctx.matchId || null);
  return { state: state };
}

function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  // [XO:INIT] Signal received — no-op handler, logging for observability
  logger.info(
    "[XO:INIT] matchSignal matchId=" +
      ctx.matchId.slice(0, 8) +
      " data=" +
      data,
  );
  return { state: state };
}

function matchmakerMatched(ctx, logger, nk, matches) {
  // [XO:INIT] Matchmaker matched — creating authoritative match for paired players
  logger.info(
    "[XO:INIT] matchmakerMatched players=" +
      matches.length +
      " creating xo match",
  );
  try {
    var mid = nk.matchCreate("xo", {});
    logger.info("[XO:INIT] matchmakerMatched → matchId=" + mid.slice(0, 8));
    return mid;
  } catch (e) {
    // [XO:WARN] matchCreate failed — matchmaker players will not get a game
    logger.error("[XO:WARN] matchCreate failed in matchmakerMatched: " + e);
    throw e;
  }
}

//  RPCs

/**
 * xo_create_room
 * Body:     { isPublic: boolean }
 * Returns:  { matchId, roomCode, isPublic }
 *
 * [XO:RPC] Consecutive actions:
 *   1. Parse payload — error if invalid JSON
 *   2. Generate room code (6-char, no ambiguous chars)
 *   3. nk.matchCreate("xo", { isPublic, roomCode, hostUserId })
 *   4. Return { matchId, roomCode, isPublic } to client
 *   (writeRoomRecord fires inside matchInit via params)
 */
function rpcCreateRoom(ctx, logger, nk, payload) {
  // [XO:RPC] rpcCreateRoom called — parsing payload
  var data;
  try {
    data = JSON.parse(payload);
  } catch (_) {
    // [XO:WARN] Bad JSON in rpcCreateRoom payload
    logger.warn(
      "[XO:WARN] rpcCreateRoom invalid JSON from user=" +
        ctx.userId.slice(0, 8),
    );
    throw new Error("Invalid JSON");
  }

  var isPublic = data.isPublic === true;
  var roomCode = generateRoomCode();
  var hostUserId = ctx.userId;

  logger.info(
    "[XO:RPC] rpcCreateRoom user=" +
      hostUserId.slice(0, 8) +
      " isPublic=" +
      isPublic +
      " generatedCode=" +
      roomCode,
  );

  var matchId;
  try {
    matchId = nk.matchCreate("xo", {
      isPublic: isPublic ? "true" : "false",
      roomCode: roomCode,
      hostUserId: hostUserId,
    });
    // [XO:RPC] Match created successfully — returning matchId + code to client
    logger.info(
      "[XO:RPC] rpcCreateRoom → matchId=" +
        matchId.slice(0, 8) +
        " code=" +
        roomCode +
        " public=" +
        isPublic,
    );
  } catch (e) {
    // [XO:WARN] matchCreate failed in rpcCreateRoom — client will not receive a matchId
    logger.error(
      "[XO:WARN] rpcCreateRoom matchCreate failed for user=" +
        hostUserId.slice(0, 8) +
        ": " +
        e,
    );
    throw e;
  }

  return JSON.stringify({
    matchId: matchId,
    roomCode: roomCode,
    isPublic: isPublic,
  });
}

/**
 * xo_join_by_code
 * Body:     { roomCode: string }
 * Returns:  { matchId: string }   on success
 *           { error: "not_found" | "full" }  on failure
 *
 * [XO:RPC] Consecutive actions:
 *   1. Parse payload + validate roomCode
 *   2. storageRead rooms/{code} under SYSTEM_USER_ID
 *   3. nk.matchList to verify match is live and has a free slot
 *   4. Return { matchId } or { error }
 */
function rpcJoinByCode(ctx, logger, nk, payload) {
  var data;
  try {
    data = JSON.parse(payload);
  } catch (_) {
    // [XO:WARN] Bad JSON in rpcJoinByCode payload
    logger.warn(
      "[XO:WARN] rpcJoinByCode invalid JSON from user=" +
        ctx.userId.slice(0, 8),
    );
    throw new Error("Invalid JSON");
  }

  var code = (data.roomCode || "").toUpperCase().trim();
  if (!code) {
    logger.warn(
      "[XO:WARN] rpcJoinByCode missing roomCode from user=" +
        ctx.userId.slice(0, 8),
    );
    throw new Error("roomCode required");
  }

  // [XO:RPC] rpcJoinByCode called — looking up room code in storage
  logger.info(
    "[XO:RPC] rpcJoinByCode user=" + ctx.userId.slice(0, 8) + " code=" + code,
  );

  var records;
  try {
    records = nk.storageRead([
      {
        collection: "rooms",
        key: code,
        userId: SYSTEM_USER_ID,
      },
    ]);
  } catch (e) {
    // [XO:WARN] storageRead failed in rpcJoinByCode — treating as not_found
    logger.warn(
      "[XO:WARN] rpcJoinByCode storageRead failed code=" + code + ": " + e,
    );
    return JSON.stringify({ error: "not_found" });
  }

  if (!records || records.length === 0) {
    // [XO:RPC] Room code not found in storage — returning not_found to client
    logger.info("[XO:RPC] rpcJoinByCode not_found for code=" + code);
    return JSON.stringify({ error: "not_found" });
  }

  var record = records[0].value;
  var matchId = record.matchId;

  // [XO:RPC] Room record found — verifying match is live and has a free slot
  try {
    var liveMatches = nk.matchList(50, true, null, 0, 2, "*");
    var found = false,
      full = false;
    for (var i = 0; i < liveMatches.length; i++) {
      if (liveMatches[i].matchId === matchId) {
        found = true;
        if (liveMatches[i].size >= 2) full = true;
        break;
      }
    }

    if (!found) {
      // [XO:RPC] matchId from room record is no longer live — cleaning up stale record
      logger.info(
        "[XO:RPC] rpcJoinByCode stale record code=" +
          code +
          " matchId=" +
          matchId.slice(0, 8) +
          " → not_found",
      );
      deleteRoomRecord(nk, logger, code);
      return JSON.stringify({ error: "not_found" });
    }

    if (full) {
      // [XO:RPC] Match found but already has 2 players — returning full to client
      logger.info(
        "[XO:RPC] rpcJoinByCode match full code=" +
          code +
          " matchId=" +
          matchId.slice(0, 8),
      );
      return JSON.stringify({ error: "full" });
    }
  } catch (e) {
    // [XO:WARN] matchList failed — returning matchId anyway, joinMatch will validate
    logger.warn(
      "[XO:WARN] rpcJoinByCode matchList failed for code=" +
        code +
        ": " +
        e +
        " — returning matchId speculatively",
    );
  }

  // [XO:RPC] Resolved successfully — returning matchId to client for joinMatch()
  logger.info(
    "[XO:RPC] rpcJoinByCode resolved code=" +
      code +
      " → matchId=" +
      matchId.slice(0, 8),
  );
  return JSON.stringify({ matchId: matchId });
}

/**
 * xo_list_public_rooms
 * Body:     {} (empty)
 * Returns:  { rooms: [{ matchId, roomCode, hostUserId, createdAt, size }] }
 *
 * [XO:RPC] Consecutive actions:
 *   1. nk.matchList(label="waiting_public", size=1) — only waiting rooms
 *   2. Map live matches to response objects
 *   3. Return rooms array (empty if none found)
 *
 * Server-side list so private rooms never leak to the client.
 * Only "waiting_public" label matches with exactly 1 player are returned.
 * hostUserId is included so the client can filter out its own rooms.
 */
function rpcListPublicRooms(ctx, logger, nk, payload) {
  // [XO:RPC] rpcListPublicRooms called -- querying waiting_public matches
  logger.info("[XO:RPC] rpcListPublicRooms user=" + ctx.userId.slice(0, 8));

  var result = [];

  try {
    var matches = nk.matchList(20, true, "waiting_public", 1, 2, "*");

    if (!matches || matches.length === 0) {
      // [XO:RPC] No public waiting rooms found -- returning empty list
      logger.info("[XO:RPC] rpcListPublicRooms -> 0 rooms");
      return JSON.stringify({ rooms: [] });
    }

    // SECURITY: nk.matchList label is a Bleve full-text query, NOT exact match.
    // Hard-filter so private rooms can never leak regardless of search backend.
    var publicOnly = [];
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].label === "waiting_public") {
        publicOnly.push(matches[i]);
      }
    }

    var leaked = matches.length - publicOnly.length;
    if (leaked > 0) {
      // [XO:WARN] Bleve token leak -- non-public match(es) stripped server-side
      logger.warn(
        "[XO:WARN] rpcListPublicRooms stripped " +
          leaked +
          " non-public match(es) that leaked through matchList label filter",
      );
    }

    if (publicOnly.length === 0) {
      return JSON.stringify({ rooms: [] });
    }

    // Batch-read room_index/{matchId} for each live public match to get
    // roomCode, hostUserId, hostUsername, createdAt in one storage call.
    var indexKeys = [];
    for (var j = 0; j < publicOnly.length; j++) {
      indexKeys.push({
        collection: "room_index",
        key: publicOnly[j].matchId,
        userId: SYSTEM_USER_ID,
      });
    }

    var indexMap = {};
    try {
      var indexRecords = nk.storageRead(indexKeys);
      for (var k = 0; k < indexRecords.length; k++) {
        indexMap[indexRecords[k].key] = indexRecords[k].value;
      }
    } catch (e2) {
      // [XO:WARN] room_index batch read failed -- rooms will have null metadata
      logger.warn("[XO:WARN] rpcListPublicRooms room_index read failed: " + e2);
    }

    for (var m = 0; m < publicOnly.length; m++) {
      var match = publicOnly[m];
      var meta = indexMap[match.matchId] || {};
      result.push({
        matchId: match.matchId,
        size: match.size || 1,
        roomCode: meta.roomCode || null,
        hostUserId: meta.hostUserId || null,
        hostUsername: meta.hostUsername || null,
        createdAt: meta.createdAt || 0,
      });
    }

    logger.info(
      "[XO:RPC] rpcListPublicRooms -> " +
        result.length +
        " public room(s) (raw=" +
        matches.length +
        " leaked=" +
        leaked +
        ")",
    );
  } catch (e) {
    // [XO:WARN] matchList failed in rpcListPublicRooms -- returning empty list
    logger.warn("[XO:WARN] rpcListPublicRooms matchList failed: " + e);
  }

  return JSON.stringify({ rooms: result });
}

//  Module init

var InitModule = function (ctx, logger, nk, initializer) {
  // [XO:LB] Creating xo_alltime leaderboard — desc score, no reset, uses "set" operator
  try {
    nk.leaderboardCreate("xo_alltime", false, "desc", "set", "", {});
    logger.info("[XO:LB] xo_alltime leaderboard ready");
  } catch (e) {
    if (String(e).indexOf("already exists") === -1) {
      // [XO:WARN] xo_alltime create failed unexpectedly (not "already exists")
      logger.warn("[XO:WARN] xo_alltime leaderboard create failed: " + e);
    } else {
      logger.info("[XO:LB] xo_alltime already exists — skipping create");
    }
  }

  // [XO:LB] Creating xo_monthly leaderboard — resets on "0 0 1 * *" (1st of month)
  try {
    nk.leaderboardCreate("xo_monthly", false, "desc", "set", "0 0 1 * *", {});
    logger.info("[XO:LB] xo_monthly leaderboard ready");
  } catch (e) {
    if (String(e).indexOf("already exists") === -1) {
      // [XO:WARN] xo_monthly create failed unexpectedly (not "already exists")
      logger.warn("[XO:WARN] xo_monthly leaderboard create failed: " + e);
    } else {
      logger.info("[XO:LB] xo_monthly already exists — skipping create");
    }
  }

  // [XO:INIT] Registering match handler under name "xo"
  initializer.registerMatch("xo", {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal,
  });

  // [XO:INIT] Registering matchmakerMatched hook — fires when auto-matchmaker pairs players
  initializer.registerMatchmakerMatched(matchmakerMatched);

  // [XO:RPC] Registering RPCs — createRoom, joinByCode, listPublicRooms
  initializer.registerRpc("xo_create_room", rpcCreateRoom);
  initializer.registerRpc("xo_join_by_code", rpcJoinByCode);
  initializer.registerRpc("xo_list_public_rooms", rpcListPublicRooms);

  // [XO:INIT] Module fully loaded — all handlers and RPCs registered
  logger.info("[XO:INIT] Module loaded — match handler v10");
};
