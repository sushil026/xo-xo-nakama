/**
 * match_handler.js — Authoritative XO match handler for Nakama (JavaScript runtime)
 * op-code 1: all client→server messages (move, forfeit, resync)
 * Server always broadcasts full state after every change.
 */

var WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

function checkWinner(board) {
  for (var i = 0; i < WIN_LINES.length; i++) {
    var a = WIN_LINES[i][0], b = WIN_LINES[i][1], c = WIN_LINES[i][2];
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
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

function saveMatchResult(ctx, nk, logger, state) {
  var matchId = state.matchId;
  try {
    nk.storageWrite([{
      collection: "matches", key: matchId,
      value: { matchId: matchId, players: state.players, moves: state.moves, winner: state.winner, createdAt: Date.now() },
      permissionRead: 2, permissionWrite: 0,
    }]);
  } catch(e) { logger.warn("[XO] saveMatchResult: " + e); }

  for (var i = 0; i < state.players.length; i++) {
    var userId = state.players[i].userId;
    var symbol = state.players[i].symbol;

    var history = [];
    try {
      var res = nk.storageRead([{ collection: "user_matches", key: "list", userId: userId }]);
      if (res.length > 0) history = res[0].value.matches || [];
    } catch(e) {}
    history.push(matchId);
    try {
      nk.storageWrite([{
        collection: "user_matches", key: "list", userId: userId,
        value: { matches: history }, permissionRead: 1, permissionWrite: 1,
      }]);
    } catch(e) {}

    try {
      var pres = nk.storageRead([{ collection: "profile", key: "data", userId: userId }]);
      if (pres.length > 0) {
        var profile = pres[0].value;
        if (state.winner === "draw") {
          profile.draws = (profile.draws || 0) + 1;
        } else {
          var won = symbol === state.winner;
          profile.wins   = (profile.wins   || 0) + (won ? 1 : 0);
          profile.losses = (profile.losses || 0) + (won ? 0 : 1);
          profile.rating = Math.max(0, (profile.rating || 1200) + (won ? 10 : -5));
        }
        nk.storageWrite([{
          collection: "profile", key: "data", userId: userId,
          value: profile, permissionRead: 2, permissionWrite: 1,
        }]);
      }
    } catch(e) { logger.warn("[XO] profile update failed: " + e); }
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
function matchInit(ctx, logger, nk, params) {
  logger.info("[XO] matchInit matchId=" + ctx.matchId);
  return {
    state: {
      board: [null,null,null,null,null,null,null,null,null],
      players: [], turn: null, winner: null, moves: [],
      matchId: ctx.matchId,
    },
    tickRate: 1,
    label: "tic-tac-toe",
  };
}

function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  var alreadyIn = false;
  for (var i = 0; i < state.players.length; i++) {
    if (state.players[i].userId === presence.userId) { alreadyIn = true; break; }
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
      if (state.players[j].userId === p.userId) { alreadyIn = true; break; }
    }
    if (!alreadyIn && state.players.length < 2) {
      var symbol = state.players.length === 0 ? "X" : "O";
      state.players.push({ userId: p.userId, symbol: symbol });
      logger.info("[XO] " + p.username + " joined as " + symbol);
    } else if (alreadyIn) {
      logger.info("[XO] " + p.username + " reconnected");
    }
  }

  if (state.players.length === 2 && !state.turn) {
    state.turn = state.players[0].userId;
    logger.info("[XO] Game started — first turn: " + state.turn.slice(0, 8));
  }

  if (state.players.length === 2) {
    broadcast(nk, dispatcher, state);
  }

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

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var data;
    try {
      data = JSON.parse(nk.binaryToString(msg.data));
    } catch(e) {
      logger.warn("[XO] Bad payload: " + e);
      continue;
    }

    // ── Resync request (empty payload, no index, no forfeit) ──────────────────
    if (typeof data.index === "undefined" && !data.forfeit) {
      logger.info("[XO] Resync from " + msg.sender.userId.slice(0, 8));
      broadcast(nk, dispatcher, state, [msg.sender]);
      continue;
    }

    // ── Forfeit ───────────────────────────────────────────────────────────────
    if (data.forfeit === true) {
      if (state.winner) continue;
      var forfeitingPlayer = null;
      var winningPlayer    = null;
      for (var j = 0; j < state.players.length; j++) {
        if (state.players[j].userId === msg.sender.userId) forfeitingPlayer = state.players[j];
        else winningPlayer = state.players[j];
      }
      if (!forfeitingPlayer || !winningPlayer) continue;
      state.winner = winningPlayer.symbol;
      logger.info("[XO] " + forfeitingPlayer.symbol + " forfeited — " + winningPlayer.symbol + " wins");
      try { saveMatchResult(ctx, nk, logger, state); } catch(e) { logger.error("[XO] saveMatchResult: " + e); }
      broadcast(nk, dispatcher, state);
      continue;
    }

    // ── Move ──────────────────────────────────────────────────────────────────
    if (state.winner) continue;

    if (msg.sender.userId !== state.turn) {
      logger.warn("[XO] Out-of-turn from " + msg.sender.userId.slice(0, 8));
      continue;
    }

    var index = data.index;
    if (typeof index !== "number" || index < 0 || index > 8 || index !== Math.floor(index)) {
      logger.warn("[XO] Invalid index " + index);
      continue;
    }

    if (state.board[index] !== null) {
      logger.warn("[XO] Cell " + index + " occupied");
      continue;
    }

    var currentPlayer = null;
    for (var k = 0; k < state.players.length; k++) {
      if (state.players[k].userId === state.turn) { currentPlayer = state.players[k]; break; }
    }
    if (!currentPlayer) continue;

    state.board[index] = currentPlayer.symbol;
    state.moves.push(index);
    logger.info("[XO] " + currentPlayer.symbol + " played cell " + index + " (move #" + state.moves.length + ")");

    var winner = checkWinner(state.board);
    if (winner) {
      state.winner = winner;
      logger.info("[XO] Winner: " + winner);
      try { saveMatchResult(ctx, nk, logger, state); } catch(e) { logger.error("[XO] saveMatchResult: " + e); }
    } else {
      var hasNull = false;
      for (var m = 0; m < state.board.length; m++) { if (state.board[m] === null) { hasNull = true; break; } }
      if (!hasNull) {
        state.winner = "draw";
        logger.info("[XO] Draw");
        try { saveMatchResult(ctx, nk, logger, state); } catch(e) { logger.error("[XO] saveMatchResult: " + e); }
      } else {
        for (var n = 0; n < state.players.length; n++) {
          if (state.players[n].userId !== state.turn) {
            state.turn = state.players[n].userId;
            break;
          }
        }
        logger.info("[XO] Next turn: " + state.turn.slice(0, 8));
      }
    }

    broadcast(nk, dispatcher, state);
    break;
  }

  return { state: state };
}

function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
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
  } catch(e) {
    logger.error("[XO] matchCreate failed: " + e);
    throw e;
  }
}

var InitModule = function(ctx, logger, nk, initializer) {
  initializer.registerMatch("xo", {
    matchInit:        matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin:        matchJoin,
    matchLeave:       matchLeave,
    matchLoop:        matchLoop,
    matchTerminate:   matchTerminate,
    matchSignal:      matchSignal,
  });
  initializer.registerMatchmakerMatched(matchmakerMatched);
  logger.info("[XO] Module loaded and registered");
};