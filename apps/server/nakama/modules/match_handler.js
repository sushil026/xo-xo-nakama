/**
 * match_handler.js — Authoritative XO match handler for Nakama (JavaScript runtime)
 * op-code 1: all client→server messages (move, forfeit, resync)
 * Server always broadcasts full state after every change.
 *
 * Storage written by server:
 *   matches/{matchId}         — full match record (public read)
 *   user_matches/list         — per-user list of match IDs (private)
 *   profile/data              — wins/losses/draws/rating/streaks/gamesPlayed
 *   leaderboard xo_alltime    — Nakama native leaderboard, never resets
 *   leaderboard xo_monthly    — Nakama native leaderboard, resets monthly
 *
 * RATING SYSTEM (provisional):
 *   - All players start at 800 (set by client setupUser)
 *   - Games 1–10: Win +30 / Loss −15 (high volatility, fast placement)
 *   - Games 11+:  Win +10 / Loss −5  (stable, incremental)
 *   - Draws:      No rating change
 *   - Floor:      0 (rating never goes negative)
 *   - gamesPlayed is incremented on every outcome and used server-side to
 *     determine the provisional window. The client mirrors this field for UI.
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

var PROVISIONAL_GAMES = 10;
var RATING_WIN_EARLY = 30;
var RATING_LOSS_EARLY = 15;
var RATING_WIN_STABLE = 10;
var RATING_LOSS_STABLE = 5;
var RATING_FLOOR = 0;
var RATING_START = 800; // mirrors setupUser default

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

// ── Leaderboard helpers ────────────────────────────────────────────────────────

/**
 * Submits wins (score) and rating (subscore) to both leaderboards.
 * Called server-side only — never from the client after a match.
 *
 * NOTE: Nakama's "BEST" operator only updates subscore when the primary score
 * also improves. If a player's win count doesn't change (e.g. on a draw or
 * loss), the rating change won't be reflected until they win again.
 * This is a known Nakama limitation. If you need rating to always update,
 * switch to using rating as the primary score field instead of wins.
 */
function submitLeaderboard(nk, logger, userId, username, wins, rating) {
  var displayName = username || "";
  try {
    nk.leaderboardRecordWrite(
      "xo_alltime",
      userId,
      displayName,
      wins,
      rating,
      {},
    );
  } catch (e) {
    logger.warn("[XO] leaderboard alltime write failed: " + e);
  }
  try {
    nk.leaderboardRecordWrite(
      "xo_monthly",
      userId,
      displayName,
      wins,
      rating,
      {},
    );
  } catch (e) {
    logger.warn("[XO] leaderboard monthly write failed: " + e);
  }
}

// ── Storage helpers ────────────────────────────────────────────────────────────

/**
 * Returns a blank profile object used when a player has no profile yet.
 * Keeps the default consistent between server and client (setupUser).
 */
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

/**
 * Apply provisional or stable rating delta for a single outcome.
 * Returns the new rating (clamped to RATING_FLOOR).
 */
function applyRatingDelta(currentRating, gamesPlayedBefore, won, drew) {
  if (drew) return currentRating; // draws: no change

  var isEarly = gamesPlayedBefore < PROVISIONAL_GAMES;

  if (won) {
    return currentRating + (isEarly ? RATING_WIN_EARLY : RATING_WIN_STABLE);
  } else {
    var penalty = isEarly ? RATING_LOSS_EARLY : RATING_LOSS_STABLE;
    return Math.max(RATING_FLOOR, currentRating - penalty);
  }
}

function saveMatchResult(ctx, nk, logger, state, endReason) {
  var matchId = state.matchId;
  var openingCell = state.moves.length > 0 ? state.moves[0] : null;

  // ── Write match record (public readable) ────────────────────────────────────
  try {
    nk.storageWrite([
      {
        collection: "matches",
        key: matchId,
        value: {
          matchId: matchId,
          players: state.players.map(function (p) {
            return {
              userId: p.userId,
              symbol: p.symbol,
              username: p.username || null,
            };
          }),
          moves: state.moves,
          winner: state.winner,
          endReason: endReason, // "win" | "draw" | "timeout" | "forfeit"
          openingCell: openingCell,
          createdAt: Date.now(),
        },
        permissionRead: 2,
        permissionWrite: 0,
      },
    ]);
  } catch (e) {
    logger.warn("[XO] match write failed: " + e);
  }

  // ── Per-player: update match list, profile stats, and leaderboard ───────────
  for (var i = 0; i < state.players.length; i++) {
    var player = state.players[i];
    var userId = player.userId;
    var symbol = player.symbol;
    var won = state.winner !== "draw" && state.winner === symbol;
    var drew = state.winner === "draw";

    // ── Append to user_matches list ──────────────────────────────────────────
    var history = [];
    try {
      var res = nk.storageRead([
        { collection: "user_matches", key: "list", userId: userId },
      ]);
      if (res.length > 0) history = res[0].value.matches || [];
    } catch (e) {
      logger.warn(
        "[XO] user_matches read failed for " + userId.slice(0, 8) + ": " + e,
      );
    }

    history.unshift(matchId);
    if (history.length > 200) history = history.slice(0, 200);

    try {
      nk.storageWrite([
        {
          collection: "user_matches",
          key: "list",
          userId: userId,
          value: { matches: history },
          permissionRead: 1,
          permissionWrite: 1,
        },
      ]);
    } catch (e) {
      logger.warn(
        "[XO] user_matches write failed for " + userId.slice(0, 8) + ": " + e,
      );
    }

    // ── Read profile (or initialise default if missing) ──────────────────────
    var profile;
    try {
      var pres = nk.storageRead([
        { collection: "profile", key: "data", userId: userId },
      ]);
      if (pres.length > 0) {
        profile = pres[0].value;
      } else {
        logger.info(
          "[XO] No profile found for " +
            userId.slice(0, 8) +
            " — initialising defaults",
        );
        profile = defaultProfile(player.username || null);
      }
    } catch (e) {
      logger.warn(
        "[XO] profile read failed for " + userId.slice(0, 8) + ": " + e,
      );
      profile = defaultProfile(player.username || null);
    }

    // Ensure gamesPlayed exists on legacy profiles (created before this field)
    if (typeof profile.gamesPlayed !== "number") {
      profile.gamesPlayed = profile.wins + profile.losses + profile.draws;
    }

    // Ensure rating exists on legacy profiles
    if (typeof profile.rating !== "number") {
      profile.rating = RATING_START;
    }

    // ── Mutate stats ─────────────────────────────────────────────────────────
    var gamesBeforeThis = profile.gamesPlayed;

    if (drew) {
      profile.draws = (profile.draws || 0) + 1;
      profile.winStreak = 0;
    } else if (won) {
      profile.wins = (profile.wins || 0) + 1;
      profile.winStreak = (profile.winStreak || 0) + 1;
      profile.bestStreak = Math.max(profile.bestStreak || 0, profile.winStreak);
    } else {
      // Loss
      profile.losses = (profile.losses || 0) + 1;
      profile.winStreak = 0;
    }

    // Apply rating delta — uses gamesBeforeThis so provisional window is exact
    profile.rating = applyRatingDelta(
      profile.rating,
      gamesBeforeThis,
      won,
      drew,
    );

    // Increment gamesPlayed after computing the delta
    profile.gamesPlayed = gamesBeforeThis + 1;

    logger.info(
      "[XO] " +
        userId.slice(0, 8) +
        " outcome=" +
        (drew ? "draw" : won ? "win" : "loss") +
        " provisional=" +
        (gamesBeforeThis < PROVISIONAL_GAMES) +
        " rating=" +
        profile.rating +
        " gamesPlayed=" +
        profile.gamesPlayed,
    );

    // ── Write updated profile back ───────────────────────────────────────────
    try {
      nk.storageWrite([
        {
          collection: "profile",
          key: "data",
          userId: userId,
          value: profile,
          permissionRead: 2,
          permissionWrite: 1,
        },
      ]);
    } catch (e) {
      logger.warn(
        "[XO] profile write failed for " + userId.slice(0, 8) + ": " + e,
      );
    }

    // ── Submit to leaderboards (server-side only) ────────────────────────────
    submitLeaderboard(
      nk,
      logger,
      userId,
      profile.username || null,
      profile.wins || 0,
      profile.rating,
    );
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

function matchInit(ctx, logger, nk, params) {
  logger.info("[XO] matchInit matchId=" + ctx.matchId);
  return {
    state: {
      board: [null, null, null, null, null, null, null, null, null],
      players: [],
      turn: null,
      winner: null,
      moves: [],
      matchId: ctx.matchId,
      turnStartTime: Date.now(),
    },
    tickRate: 1,
    label: "tic-tac-toe",
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
  var alreadyIn = false;
  for (var i = 0; i < state.players.length; i++) {
    if (state.players[i].userId === presence.userId) {
      alreadyIn = true;
      break;
    }
  }
  if (!alreadyIn && state.players.length >= 2) {
    return { state: state, accept: false, rejectMessage: "Match is full" };
  }
  return { state: state, accept: true };
}

function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
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
      var symbol = state.players.length === 0 ? "X" : "O";
      state.players.push({
        userId: p.userId,
        symbol: symbol,
        username: p.username,
      });
      logger.info("[XO] " + p.username + " joined as " + symbol);
    } else if (alreadyIn) {
      logger.info("[XO] " + p.username + " reconnected");
    }
  }

  if (state.players.length === 2 && !state.turn) {
    state.turn = state.players[0].userId;
    state.turnStartTime = Date.now();
    logger.info("[XO] Game started — first turn: " + state.turn.slice(0, 8));
  }

  if (state.players.length === 2) broadcast(nk, dispatcher, state);
  return { state: state };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var i = 0; i < presences.length; i++) {
    logger.info("[XO] " + presences[i].username + " left");
  }
  return { state: state };
}

function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  if (state.winner !== null) return { state: state };

  var TURN_LIMIT = 30000;

  // ── Timeout check ──────────────────────────────────────────────────────────
  if (state.turn && !state.winner) {
    var elapsed = Date.now() - state.turnStartTime;
    if (elapsed > TURN_LIMIT) {
      logger.info("[XO] Turn timeout for " + state.turn.slice(0, 8));
      var winnerPlayer = null;
      for (var i = 0; i < state.players.length; i++) {
        if (state.players[i].userId !== state.turn) {
          winnerPlayer = state.players[i];
          break;
        }
      }
      if (winnerPlayer) {
        state.winner = winnerPlayer.symbol;
        state.turnStartTime = 0;
        logger.info("[XO] Timeout — winner: " + state.winner);
        try {
          saveMatchResult(ctx, nk, logger, state, "timeout");
        } catch (e) {
          logger.error("[XO] saveMatchResult: " + e);
        }
        broadcast(nk, dispatcher, state);
      }
      return { state: state };
    }
  }

  // ── Process messages ───────────────────────────────────────────────────────
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var data;
    try {
      data = JSON.parse(nk.binaryToString(msg.data));
    } catch (e) {
      logger.warn("[XO] Bad payload: " + e);
      continue;
    }

    // Resync
    if (typeof data.index === "undefined" && !data.forfeit) {
      logger.info("[XO] Resync from " + msg.sender.userId.slice(0, 8));
      broadcast(nk, dispatcher, state, [msg.sender]);
      continue;
    }

    // Forfeit
    if (data.forfeit === true) {
      if (state.winner) continue;
      var forfeitingPlayer = null;
      var winningPlayer = null;
      for (var j = 0; j < state.players.length; j++) {
        if (state.players[j].userId === msg.sender.userId)
          forfeitingPlayer = state.players[j];
        else winningPlayer = state.players[j];
      }
      if (!forfeitingPlayer || !winningPlayer) continue;
      state.winner = winningPlayer.symbol;
      state.turnStartTime = 0;
      logger.info(
        "[XO] " +
          forfeitingPlayer.symbol +
          " forfeited — " +
          winningPlayer.symbol +
          " wins",
      );
      try {
        saveMatchResult(ctx, nk, logger, state, "forfeit");
      } catch (e) {
        logger.error("[XO] saveMatchResult: " + e);
      }
      broadcast(nk, dispatcher, state);
      continue;
    }

    // Move
    if (state.winner) continue;
    if (msg.sender.userId !== state.turn) {
      logger.warn("[XO] Out-of-turn from " + msg.sender.userId.slice(0, 8));
      continue;
    }

    var index = data.index;
    if (
      typeof index !== "number" ||
      index < 0 ||
      index > 8 ||
      index !== Math.floor(index)
    ) {
      logger.warn("[XO] Invalid index " + index);
      continue;
    }
    if (state.board[index] !== null) {
      logger.warn("[XO] Cell " + index + " occupied");
      continue;
    }

    var currentPlayer = null;
    for (var k = 0; k < state.players.length; k++) {
      if (state.players[k].userId === state.turn) {
        currentPlayer = state.players[k];
        break;
      }
    }
    if (!currentPlayer) continue;

    state.board[index] = currentPlayer.symbol;
    state.moves.push(index);
    logger.info(
      "[XO] " +
        currentPlayer.symbol +
        " played cell " +
        index +
        " (move #" +
        state.moves.length +
        ")",
    );

    var winner = checkWinner(state.board);
    if (winner) {
      state.winner = winner;
      state.turnStartTime = 0;
      logger.info("[XO] Winner: " + winner);
      try {
        saveMatchResult(ctx, nk, logger, state, "win");
      } catch (e) {
        logger.error("[XO] saveMatchResult: " + e);
      }
    } else {
      var hasNull = false;
      for (var m = 0; m < state.board.length; m++) {
        if (state.board[m] === null) {
          hasNull = true;
          break;
        }
      }
      if (!hasNull) {
        state.winner = "draw";
        state.turnStartTime = 0;
        logger.info("[XO] Draw");
        try {
          saveMatchResult(ctx, nk, logger, state, "draw");
        } catch (e) {
          logger.error("[XO] saveMatchResult: " + e);
        }
      } else {
        for (var n = 0; n < state.players.length; n++) {
          if (state.players[n].userId !== state.turn) {
            state.turn = state.players[n].userId;
            break;
          }
        }
        state.turnStartTime = Date.now();
        logger.info("[XO] Next turn: " + state.turn.slice(0, 8));
      }
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
  logger.info("[XO] matchTerminate grace=" + graceSeconds);
  return { state: state };
}

function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  return { state: state };
}

function matchmakerMatched(ctx, logger, nk, matches) {
  logger.info("[XO] matchmakerMatched — " + matches.length + " players");
  try {
    return nk.matchCreate("xo");
  } catch (e) {
    logger.error("[XO] matchCreate failed: " + e);
    throw e;
  }
}

// ── Leaderboard initialisation (run once on module load) ──────────────────────

var InitModule = function (ctx, logger, nk, initializer) {
  try {
    nk.leaderboardCreate("xo_alltime", false, "desc", "best", "", {});
    logger.info("[XO] Leaderboard xo_alltime ready");
  } catch (e) {
    if (String(e).indexOf("already exists") !== -1) {
      logger.info("[XO] xo_alltime already exists, skipping create");
    } else {
      logger.warn("[XO] xo_alltime create failed: " + e);
    }
  }

  try {
    nk.leaderboardCreate("xo_monthly", false, "desc", "best", "0 0 1 * *", {});
    logger.info("[XO] Leaderboard xo_monthly ready");
  } catch (e) {
    if (String(e).indexOf("already exists") !== -1) {
      logger.info("[XO] xo_monthly already exists, skipping create");
    } else {
      logger.warn("[XO] xo_monthly create failed: " + e);
    }
  }

  initializer.registerMatch("xo", {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal,
  });
  initializer.registerMatchmakerMatched(matchmakerMatched);
  logger.info("[XO] Module loaded and registered");
};
