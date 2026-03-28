const matchInit = (ctx, logger, nk, params) => {
  return {
    state: {
      board: Array(9).fill(null),
      players: [],
      turn: null,
      winner: null,
      moves: [], // ✅ track moves
      matchId: ctx.matchId,
    },
    tickRate: 1,
    label: "tic-tac-toe",
  };
};

const matchJoin = (ctx, logger, nk, dispatcher, tick, state, presences) => {
  presences.forEach((p) => {
    if (state.players.length < 2) {
      state.players.push({
        userId: p.userId,
        symbol: state.players.length === 0 ? "X" : "O",
      });
    }
  });

  if (state.players.length === 2 && !state.turn) {
    state.turn = state.players[0].userId;
  }

  return { state };
};

const checkWinner = (board) => {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6],
  ];

  for (let [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
};

const saveMatchResult = async (ctx, nk, state) => {
  const matchId = state.matchId;

  const result = {
    matchId,
    players: state.players,
    moves: state.moves,
    winner: state.winner,
    createdAt: Date.now(),
  };

  // ✅ 1. Store global match
  await nk.storageWrite([
    {
      collection: "matches",
      key: matchId,
      value: result,
      permissionRead: 2,
      permissionWrite: 0,
    },
  ]);

  // ✅ 2. Update each user's history + profile
  for (const player of state.players) {
    const userId = player.userId;

    // --- MATCH HISTORY ---
    let history = [];
    try {
      const res = await nk.storageRead([
        { collection: "user_matches", key: "list", userId },
      ]);
      if (res.length > 0) {
        history = res[0].value.matches || [];
      }
    } catch {}

    history.push(matchId);

    await nk.storageWrite([
      {
        collection: "user_matches",
        key: "list",
        userId,
        value: { matches: history },
        permissionRead: 1,
        permissionWrite: 1,
      },
    ]);

    // --- PROFILE UPDATE ---
    try {
      const res = await nk.storageRead([
        { collection: "profile", key: "data", userId },
      ]);

      if (res.length > 0) {
        const profile = res[0].value;

        if (state.winner === "draw") {
          profile.draws += 1;
        } else {
          const isWinner =
            player.symbol === state.winner;

          if (isWinner) {
            profile.wins += 1;
            profile.rating += 10;
          } else {
            profile.losses += 1;
            profile.rating -= 5;
          }
        }

        await nk.storageWrite([
          {
            collection: "profile",
            key: "data",
            userId,
            value: profile,
            permissionRead: 2,
            permissionWrite: 1,
          },
        ]);
      }
    } catch {}
  }
};

const matchLoop = (ctx, logger, nk, dispatcher, tick, state, messages) => {
  messages.forEach((msg) => {
    const data = JSON.parse(nk.binaryToString(msg.data));

    if (state.winner) return;

    if (msg.sender.userId !== state.turn) return;

    const { index } = data;

    if (state.board[index] !== null) return;

    const currentPlayer = state.players.find(
      (p) => p.userId === state.turn
    );

    const symbol = currentPlayer.symbol;

    // ✅ apply move
    state.board[index] = symbol;
    state.moves.push(index);

    const winner = checkWinner(state.board);

    if (winner) {
      state.winner = winner;

      // ✅ SAVE RESULT
      saveMatchResult(ctx, nk, state);

    } else if (!state.board.includes(null)) {
      state.winner = "draw";

      // ✅ SAVE RESULT
      saveMatchResult(ctx, nk, state);

    } else {
      state.turn = state.players.find(
        (p) => p.userId !== state.turn
      ).userId;
    }

    dispatcher.broadcastMessage(
      1,
      nk.stringToBinary(JSON.stringify(state))
    );
  });

  return { state };
};

global.matchInit = matchInit;
global.matchJoin = matchJoin;
global.matchLoop = matchLoop;