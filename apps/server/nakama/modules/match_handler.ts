const matchInit = (ctx, logger, nk, params) => {
  return {
    state: {
      board: Array(9).fill(null),
      players: [],
      turn: null,
      winner: null,
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
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (let [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
};

const matchLoop = (ctx, logger, nk, dispatcher, tick, state, messages) => {
  messages.forEach((msg) => {
    const data = JSON.parse(nk.binaryToString(msg.data));

    if (state.winner) return;

    if (msg.sender.userId !== state.turn) return;

    const { index } = data;

    if (state.board[index] !== null) return;

    const currentPlayer = state.players.find((p) => p.userId === state.turn);
    const symbol = currentPlayer.symbol;

    state.board[index] = symbol;

    const winner = checkWinner(state.board);

    if (winner) {
      state.winner = winner;
    } else if (!state.board.includes(null)) {
      state.winner = "draw";
    } else {
      state.turn = state.players.find((p) => p !== state.turn);
    }

    dispatcher.broadcastMessage(1, nk.stringToBinary(JSON.stringify(state)));
  });

  return { state };
};

global.matchInit = matchInit;
global.matchJoin = matchJoin;
global.matchLoop = matchLoop;
