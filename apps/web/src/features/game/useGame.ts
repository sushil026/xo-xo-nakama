import { useEffect, useRef, useState } from "react";
import { connect, getSocket } from "../../services/nakamaClient";

//  Op-codes (must mirror your Nakama server module) 
// Client → Server
export const OP_MOVE = 1;          // payload: { index: number }

// Server → Client
export const OP_STATE     = 2;     // payload: GameState (full board snapshot)
export const OP_GAME_OVER = 3;     // payload: { winner: "X" | "O" | "draw" }

//  Types 
export interface GameState {
  board: (string | null)[];
  turn: "X" | "O";
}

export interface GameHookState {
  board: (string | null)[];
  turn: "X" | "O" | null;
  winner: "X" | "O" | "draw" | null;
  matchId: string | null;
  isConnected: boolean;
  error: string | null;
}

//  Hook 
export const useGame = () => {
  const [hookState, setHookState] = useState<GameHookState>({
    board: Array(9).fill(null),
    turn: null,
    winner: null,
    matchId: null,
    isConnected: false,
    error: null,
  });

  // Keep socket in a ref so stable callbacks can always access the latest socket
  const socketRef = useRef<Awaited<ReturnType<typeof connect>>["socket"] | null>(null);
  const matchIdRef = useRef<string | null>(null);

  //  Init: connect once and register persistent socket listeners 
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const res = await connect();
        if (!mounted) return;

        socketRef.current = res.socket;

        // Server → client: full board snapshot after every move
        res.socket.onmatchdata = (data) => {
          if (!mounted) return;

          try {
            const decoded = JSON.parse(new TextDecoder().decode(data.data as Uint8Array));

            if (data.op_code === OP_STATE) {
              const gs = decoded as GameState;
              setHookState((prev) => ({
                ...prev,
                board: gs.board,
                turn: gs.turn,
              }));
            }

            if (data.op_code === OP_GAME_OVER) {
              setHookState((prev) => ({
                ...prev,
                winner: decoded.winner ?? null,
              }));
            }
          } catch {
            // Malformed packet — silently ignore
          }
        };

        setHookState((prev) => ({ ...prev, isConnected: true, error: null }));
      } catch (e) {
        if (!mounted) return;
        setHookState((prev) => ({
          ...prev,
          isConnected: false,
          error: e instanceof Error ? e.message : "Connection failed",
        }));
      }
    };

    init();
    return () => { mounted = false; };
  }, []);

  //  createMatch 
  const createMatch = async () => {
    const socket = socketRef.current;
    if (!socket) return;

    try {
      const match = await socket.createMatch();
      await socket.joinMatch(match.match_id);
      matchIdRef.current = match.match_id;
      setHookState((prev) => ({
        ...prev,
        matchId: match.match_id,
        board: Array(9).fill(null),
        turn: "X",
        winner: null,
      }));
    } catch (e) {
      setHookState((prev) => ({
        ...prev,
        error: e instanceof Error ? e.message : "Failed to create match",
      }));
    }
  };

  //  joinMatch 
  const joinMatch = async (id: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    try {
      await socket.joinMatch(id);
      matchIdRef.current = id;
      setHookState((prev) => ({
        ...prev,
        matchId: id,
        board: Array(9).fill(null),
        turn: "X",
        winner: null,
      }));
    } catch (e) {
      setHookState((prev) => ({
        ...prev,
        error: e instanceof Error ? e.message : "Failed to join match",
      }));
    }
  };

  //  makeMove 
  // Guards:
  //   • match must be active
  //   • cell must be empty
  //   • game must not be over
  // NOTE: turn enforcement is server-authoritative. The server rejects moves
  //       from the wrong player; we just send and let the state update confirm.
  const makeMove = (index: number) => {
    const matchId = matchIdRef.current;
    if (!matchId || hookState.winner) return;
    if (hookState.board[index] !== null) return;   // cell occupied

    try {
      const socket = getSocket();
      const payload = new TextEncoder().encode(JSON.stringify({ index }));
      socket.sendMatchState(matchId, OP_MOVE, payload);
    } catch {
      setHookState((prev) => ({ ...prev, error: "Failed to send move" }));
    }
  };

  return {
    ...hookState,
    createMatch,
    joinMatch,
    makeMove,
  };
};