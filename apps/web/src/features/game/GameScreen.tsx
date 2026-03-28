import { useGame } from "./useGame";

export default function GameScreen() {
  const { createMatch, makeMove, state, matchId } = useGame();

  return (
    <div style={{ padding: 20 }}>
      <h2>Game</h2>

      {!matchId && (
        <button onClick={createMatch}>Create Match</button>
      )}

      {matchId && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 80px)" }}>
            {Array.isArray(state?.board) && state.board.map((cell: string, i: number) => (
              <button key={i} onClick={() => makeMove(i)}>
                {cell}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}