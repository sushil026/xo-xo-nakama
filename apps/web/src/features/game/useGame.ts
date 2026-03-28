import { useEffect, useState } from "react";
import { connect } from "../../services/nakamaClient";

export const useGame = () => {
  const [socket, setSocket] = useState<
    Awaited<ReturnType<typeof connect>>["socket"] | null
  >(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const res = await connect();
      res.socket.onmatchdata = (data: { data: Uint8Array }) => {
        const decoded = JSON.parse(new TextDecoder().decode(data.data));
        console.log("GAME STATE:", decoded);
        setState(decoded);
      };

      if (mounted) {
        setSocket(res.socket);
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, []);

  const createMatch = async () => {
    if (!socket) return;
    const match = await socket.createMatch();
    console.log("Created match:", match.match_id);

    await socket.joinMatch(match.match_id);

    setMatchId(match.match_id);
  };

  const joinMatch = async (id: string) => {
    if (!socket) return;
    await socket.joinMatch(id);
    setMatchId(id);
  };

  const makeMove = (index: number) => {
    if (!matchId || !socket) return;

    const payload = JSON.stringify({ index });
    const encoded = new TextEncoder().encode(payload);
    socket.sendMatchState(matchId, 1, encoded);
  };

  return {
    createMatch,
    joinMatch,
    makeMove,
    state,
    matchId,
  };
};
