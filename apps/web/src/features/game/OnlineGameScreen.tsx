import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  connect,
  recordMatchAnalytics,
  getSocket,
  type StoredMatch,
} from "../../services/nakamaClient";

//  Constants
const OP_STATE = 1;
const TIMER_SECS = 30;
const NUM_BARS = 10;

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

const CELL_LABEL = [
  "top-1",
  "top-2",
  "top-3",
  "mid-1",
  "mid-2",
  "mid-3",
  "bot-1",
  "bot-2",
  "bot-3",
] as const;

//  Types
type Player = "X" | "O";
type Cell = Player | null;
type Result = Player | "draw" | null;
type EndReason = "win" | "draw" | "timeout" | "forfeit";

interface ServerPlayer {
  userId: string;
  symbol: Player;
  username?: string;
}

interface ServerState {
  board: (string | null)[];
  players: ServerPlayer[];
  turn: string | null;
  winner: string | null;
  moves: number[];
  matchId: string;
}

/**
 * Derived client-side truth: computed once per server state update.
 * This is the single source of truth for all display logic.
 */
interface DerivedState {
  cells: Cell[];
  mySymbol: Player | null; // null until server confirms
  oppSymbol: Player | null;
  isMyTurn: boolean;
  result: Result; // null = game on
  iWon: boolean;
  isDraw: boolean;
  winLine: readonly number[] | null;
  myMoves: string[];
  oppMoves: string[];
  waiting: boolean; // < 2 players joined
  endReason: EndReason | null;
  timeoutDetected: boolean;
}

//  Pure helpers
function checkWinLine(b: Cell[]): readonly number[] | null {
  for (const line of WIN_LINES) {
    const [a, b1, c] = line;
    if (b[a] && b[a] === b[b1] && b[a] === b[c]) return line;
  }
  return null;
}

function opposite(sym: Player): Player {
  return sym === "X" ? "O" : "X";
}

/**
 * Derive all display state from raw server state + my userId.
 * This is the ONLY place symbols are resolved — all comparisons
 * go through `mySymbol` read from ss.players, never from props.
 */
function deriveState(
  ss: ServerState,
  myId: string | null,
  prevEndReason: EndReason | null,
  forfeitActive: boolean,
): DerivedState {
  const cells = ss.board.map((v) =>
    v === "X" || v === "O" ? (v as Player) : null,
  ) as Cell[];

  const waiting = ss.players.length < 2;

  // Server-authoritative symbol resolution
  const myEntry = myId ? ss.players.find((p) => p.userId === myId) : null;
  const oppEntry = myId ? ss.players.find((p) => p.userId !== myId) : null;
  const mySymbol: Player | null = myEntry?.symbol ?? null;
  const oppSymbol: Player | null =
    oppEntry?.symbol ?? (mySymbol ? opposite(mySymbol) : null);

  const isMyTurn = !!myId && ss.turn === myId && !ss.winner;

  // Move attribution: X always moves on even indices (0,2,4…), O on odd
  const xSet = new Set<number>();
  const oSet = new Set<number>();
  ss.moves.forEach((idx, i) => {
    if (i % 2 === 0) xSet.add(idx);
    else oSet.add(idx);
  });
  const mySet = mySymbol === "X" ? xSet : oSet;
  const oppSet = mySymbol === "X" ? oSet : xSet;

  const myMoves = ss.moves
    .filter((idx) => mySet.has(idx))
    .map((idx) => CELL_LABEL[idx] as string);
  const oppMoves = ss.moves
    .filter((idx) => oppSet.has(idx))
    .map((idx) => CELL_LABEL[idx] as string);

  let result: Result = null;
  let iWon = false;
  let isDraw = false;
  let winLine: readonly number[] | null = null;
  let endReason: EndReason | null = prevEndReason;
  let timeoutDetected = false;

  if (ss.winner) {
    isDraw = ss.winner === "draw";
    iWon = !isDraw && mySymbol !== null && ss.winner === mySymbol;
    result = isDraw ? "draw" : iWon ? mySymbol! : oppSymbol!;
    winLine = isDraw ? null : checkWinLine(cells);

    // Determine end reason if not already set by a client-side forfeit
    if (!forfeitActive) {
      const boardFull = ss.board.every((c) => c !== null);
      const hasWinLine = winLine !== null;

      if (isDraw) {
        endReason = "draw";
      } else if (!boardFull && !hasWinLine) {
        // Cells empty + no winning line = timeout
        timeoutDetected = true;
        endReason = "timeout";
      } else {
        endReason = "win";
      }
    }
  }

  return {
    cells,
    mySymbol,
    oppSymbol,
    isMyTurn,
    result,
    iWon,
    isDraw,
    winLine,
    myMoves,
    oppMoves,
    waiting,
    endReason,
    timeoutDetected,
  };
}

function decodeServerState(raw: unknown): ServerState {
  let str: string;
  if (typeof raw === "string") {
    try {
      const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
      str = new TextDecoder().decode(bytes);
    } catch {
      str = raw;
    }
  } else if (raw instanceof Uint8Array) {
    str = new TextDecoder().decode(raw);
  } else {
    str = new TextDecoder().decode(new Uint8Array(raw as ArrayBuffer));
  }
  return JSON.parse(str) as ServerState;
}

//  Logger
const ts = () => new Date().toISOString().slice(11, 23);
const log = {
  info: (m: string, ...d: unknown[]) =>
    console.log(`%c[XO ${ts()}] ${m}`, "color:#22c55e;font-weight:600", ...d),
  warn: (m: string, ...d: unknown[]) =>
    console.warn(`%c[XO ${ts()}] ${m}`, "color:#f59e0b;font-weight:600", ...d),
  error: (m: string, ...d: unknown[]) =>
    console.error(`%c[XO ${ts()}] ${m}`, "color:#ef4444;font-weight:600", ...d),
  state: (ss: ServerState, myId: string | null) => {
    console.groupCollapsed(
      `%c[XO ${ts()}] 📦 SERVER STATE`,
      "color:#818cf8;font-weight:600",
    );
    console.log("board   :", ss.board.map((c, i) => c ?? `_${i}`).join(" | "));
    console.log(
      "players :",
      ss.players.map((p) => `${p.symbol}=${p.userId.slice(0, 6)}`).join(", "),
    );
    console.log(
      "turn    :",
      ss.turn
        ? `${ss.turn.slice(0, 6)}${ss.turn === myId ? " (ME)" : " (OPP)"}`
        : "null",
    );
    console.log("winner  :", ss.winner ?? "none");
    console.log("moves   :", ss.moves.join(", ") || "—");
    console.groupEnd();
  },
};

//  Props
interface Props {
  matchId: string;
  opponentName: string;
  iAmX: boolean; // hint only — server state is authoritative
  // FIX: added gameMode prop so StoredMatch can be fully constructed
  gameMode?: StoredMatch["gameMode"];
  onBack: () => void;
}

//
// Main Component
//
export default function OnlineGameScreen({
  matchId,
  opponentName,
  iAmX,
  gameMode = "room_public",
  onBack,
}: Props) {
  //  State
  const [derived, setDerived] = useState<DerivedState>({
    cells: Array(9).fill(null),
    mySymbol: iAmX ? "X" : "O", // prop hint; overwritten on first server msg
    oppSymbol: iAmX ? "O" : "X",
    isMyTurn: false,
    result: null,
    iWon: false,
    isDraw: false,
    winLine: null,
    myMoves: [],
    oppMoves: [],
    waiting: true,
    endReason: null,
    timeoutDetected: false,
  });

  const [connLost, setConnLost] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECS);
  const [forfeitMsg, setForfeitMsg] = useState<string | null>(null);
  const [timeoutMsg, setTimeoutMsg] = useState<string | null>(null);

  //  Refs
  const mountedRef = useRef(true);
  const myUserIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const derivedRef = useRef(derived); // always in sync with state
  const analyticsRecordedRef = useRef(false);
  const forfeitActiveRef = useRef(false);

  // Keep derivedRef in sync
  useEffect(() => {
    derivedRef.current = derived;
  }, [derived]);

  //  Timer
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    setTimeLeft(TIMER_SECS);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearTimer]);

  //  Analytics
  // FIX: capture gameMode in closure via ref so it's always current
  const gameModeRef = useRef(gameMode);
  useEffect(() => {
    gameModeRef.current = gameMode;
  }, [gameMode]);

  const recordAnalytics = useCallback((ss: ServerState, d: DerivedState) => {
    if (analyticsRecordedRef.current || !d.endReason) return;
    analyticsRecordedRef.current = true;
    connect().then(({ session }) => {
      const storedMatch: StoredMatch = {
        matchId: ss.matchId,
        players: ss.players,
        moves: ss.moves,
        winner: ss.winner,
        endReason: d.endReason!,
        openingCell: ss.moves.length > 0 ? ss.moves[0] : null,
        createdAt: Date.now(),
        // FIX: was referencing undefined `currentGameMode`; now uses prop via ref
        gameMode: gameModeRef.current,
      };
      recordMatchAnalytics(session, storedMatch, d.mySymbol ?? "X").catch(
        () => {},
      );
    });
  }, []);

  //  Apply server state (single source of truth)
  const applyServerState = useCallback(
    (ss: ServerState) => {
      const myId = myUserIdRef.current;
      log.state(ss, myId);

      const next = deriveState(
        ss,
        myId,
        derivedRef.current.endReason,
        forfeitActiveRef.current,
      );

      setDerived(next);

      if (next.waiting) {
        log.warn(`Only ${ss.players.length}/2 players — waiting`);
        return;
      }

      if (next.result) {
        clearTimer();

        // Set human-readable timeout message
        if (next.timeoutDetected) {
          const msg = next.iWon
            ? "Opponent ran out of time — you win!"
            : "You ran out of time — opponent wins";
          setTimeoutMsg(msg);
        }

        recordAnalytics(ss, next);
      } else {
        // Game still live — (re)start turn timer
        startTimer();
      }
    },
    [clearTimer, startTimer, recordAnalytics],
  );

  //  Socket wiring
  useEffect(() => {
    mountedRef.current = true;
    log.info(`Mounting — matchId=${matchId.slice(0, 8)} iAmX=${iAmX}`);

    const attach = async () => {
      try {
        const { socket, session } = await connect();
        socket.onmatchdata = null;
        socket.ondisconnect = null;

        if (!mountedRef.current) return;

        myUserIdRef.current = session.user_id ?? null;
        log.info(`Connected — userId=${session.user_id?.slice(0, 8)}`);

        setConnLost(false);
        setReconnecting(false);

        socket.onmatchdata = (data) => {
          if (!mountedRef.current) return;
          if (data.op_code !== OP_STATE) {
            log.warn(`Unknown op_code ${data.op_code} — ignoring`);
            return;
          }
          try {
            applyServerState(decodeServerState(data.data));
          } catch (e) {
            log.error("Decode/apply failed", e);
          }
        };

        socket.ondisconnect = () => {
          if (!mountedRef.current) return;
          log.warn("Disconnected");
          setConnLost(true);
          clearTimer();

          if (!derivedRef.current.result) {
            forfeitActiveRef.current = true;
            setForfeitMsg("Connection lost — opponent wins");
            // Optimistically mark loss; server will confirm when reconnected
            setDerived((prev) => ({
              ...prev,
              result: prev.oppSymbol,
              iWon: false,
              isDraw: false,
              endReason: "forfeit",
            }));
          }

          setReconnecting(true);
          setTimeout(() => {
            if (!mountedRef.current) return;
            setReconnecting(false);
            attach();
          }, 2000);
        };

        // Request resync immediately
        try {
          socket.sendMatchState(
            matchId,
            OP_STATE,
            new TextEncoder().encode("{}"),
          );
          log.info("Resync requested");
        } catch (e) {
          log.warn("Resync send failed", e);
        }
      } catch (e) {
        if (!mountedRef.current) return;
        log.error("attach() failed", e);
        setConnLost(true);
      }
    };

    attach();
    return () => {
      mountedRef.current = false;
      clearTimer();
      log.info("Unmounting");
    };
  }, [matchId, iAmX, applyServerState, clearTimer]);

  //  Send move
  const handleMove = (idx: number) => {
    const { cells, result, isMyTurn, waiting } = derivedRef.current;
    if (cells[idx] || result || !isMyTurn || connLost || waiting) return;
    log.info(`Move: cell ${idx}`);
    try {
      getSocket().sendMatchState(
        matchId,
        OP_STATE,
        new TextEncoder().encode(JSON.stringify({ index: idx })),
      );
    } catch (e) {
      log.error("sendMatchState failed", e);
      setConnLost(true);
    }
  };

  //  Forfeit
  const handleForfeit = () => {
    if (derivedRef.current.result) return;
    log.info("Player forfeited");
    clearTimer();
    forfeitActiveRef.current = true;

    try {
      getSocket().sendMatchState(
        matchId,
        OP_STATE,
        new TextEncoder().encode(JSON.stringify({ forfeit: true })),
      );
    } catch (e) {
      log.error("Forfeit send failed", e);
    }

    setForfeitMsg("You forfeited — opponent wins");
    setDerived((prev) => ({
      ...prev,
      result: prev.oppSymbol,
      iWon: false,
      isDraw: false,
      endReason: "forfeit",
    }));

    setTimeout(onBack, 3000);
  };

  //  Derived display values
  const {
    cells,
    mySymbol,
    oppSymbol,
    isMyTurn,
    result,
    iWon,
    isDraw,
    winLine,
    myMoves,
    oppMoves,
    waiting,
  } = derived;

  const timerLow = timeLeft <= 10 && isMyTurn && !result && !waiting;
  const activeColor = isMyTurn ? "var(--coral)" : "var(--amber)";

  //  Render
  return (
    <div
      className="screen"
      role="main"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Background glyphs */}
      <span
        className="bg-glyph pulse"
        style={{ fontSize: 200, right: -30, top: -20 }}
        aria-hidden
      >
        X
      </span>
      <span
        className="bg-glyph"
        style={{ fontSize: 150, left: -20, bottom: 80, animationDelay: "2s" }}
        aria-hidden
      >
        O
      </span>

      {/* Top bar */}
      <header className="topbar" style={{ flexShrink: 0 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack} type="button">
          ←
        </button>
        <div className="topbar-logo">
          XO<span className="topbar-logo-accent">.</span>
        </div>
        <span
          className="pill"
          style={{
            borderColor: "var(--coral)",
            color: "var(--coral)",
            fontSize: 9,
          }}
        >
          Online
        </span>
      </header>

      {/* Connection banner */}
      {connLost && (
        <Banner color="#ef4444" rgb="239,68,68">
          {reconnecting ? "Reconnecting…" : "Connection lost — opponent wins"}
        </Banner>
      )}

      {/* My row */}
      <PlayerRow
        label="You"
        symbol={mySymbol ?? (iAmX ? "X" : "O")}
        isMe={true}
        active={isMyTurn && !waiting}
        log={myMoves}
        result={result}
        winner={iWon}
        isDraw={isDraw}
      />

      {/* Turn strip + timer */}
      {!result && !waiting && (
        <>
          <TurnStrip
            isMyTurn={isMyTurn}
            opponentName={opponentName}
            timeLeft={timeLeft}
            timerLow={timerLow}
            activeColor={activeColor}
          />
          <TimerBars
            timeLeft={timeLeft}
            timerLow={timerLow}
            activeColor={activeColor}
          />
        </>
      )}

      {/* Board */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch" as const,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px var(--pad)",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "relative",
            opacity: result ? 0.22 : 1,
            transition: "opacity 300ms steps(4)",
            filter: result ? "grayscale(1)" : "none",
          }}
        >
          <Corner pos="tl" color={activeColor} dim={!!result} />
          <Corner pos="tr" color={activeColor} dim={!!result} />
          <Corner pos="bl" color={activeColor} dim={!!result} />
          <Corner pos="br" color={activeColor} dim={!!result} />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 2,
              background: "var(--surface-hi)",
              border: "2px solid var(--surface-hi)",
              width: "min(78vw,300px)",
              boxShadow:
                timerLow && isMyTurn
                  ? "0 0 40px rgba(255,85,64,0.25)"
                  : "0 0 40px rgba(255,85,64,0.08)",
              transition: "box-shadow 200ms steps(3)",
            }}
          >
            {cells.map((cell, i) => (
              <BoardCell
                key={i}
                cell={cell}
                isWin={winLine?.includes(i) ?? false}
                hoverMark={
                  isMyTurn && !cell && !result && !waiting
                    ? (mySymbol ?? null)
                    : null
                }
                onClick={() => handleMove(i)}
                disabled={
                  !!cell || !!result || !isMyTurn || connLost || waiting
                }
              />
            ))}
          </div>
        </div>

        {result && (
          <ResultCard
            iWon={iWon}
            isDraw={isDraw}
            mySymbol={mySymbol ?? (iAmX ? "X" : "O")}
            oppLabel={opponentName}
            forfeitMsg={forfeitMsg}
            timeoutMsg={timeoutMsg}
            board={cells}
            winLine={winLine}
            onBack={onBack}
          />
        )}
      </div>

      {/* Opponent row */}
      <PlayerRow
        label={opponentName}
        symbol={oppSymbol ?? (iAmX ? "O" : "X")}
        isMe={false}
        active={!result && !isMyTurn && !waiting}
        log={oppMoves}
        result={result}
        winner={!!result && !iWon && !isDraw}
        isDraw={isDraw}
      />

      {/* Footer */}
      <footer style={{ padding: "12px var(--pad)", flexShrink: 0 }}>
        <div className="prog-bar" style={{ marginBottom: 12 }} />
        <button
          className="btn btn-ghost btn-full"
          onClick={handleForfeit}
          disabled={!!result}
          type="button"
        >
          ← Forfeit
        </button>
      </footer>

      <style>{`
        @keyframes turnBlink    { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes cellIn       { from{transform:scale(.4);opacity:0} to{transform:scale(1);opacity:1} }
        @keyframes resultSlide  { from{transform:translateY(32px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes scanline     { from{transform:translateY(-100%)} to{transform:translateY(100%)} }
        @keyframes timerPulse   { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}

//
// Sub-components
//

//  Banner
function Banner({
  color,
  rgb,
  children,
}: {
  color: string;
  rgb: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        background: `rgba(${rgb},0.1)`,
        borderBottom: `1px solid rgba(${rgb},0.25)`,
        padding: "8px var(--pad)",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
          display: "inline-block",
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
          color,
        }}
      >
        {children}
      </span>
    </div>
  );
}

//  Turn strip
function TurnStrip({
  isMyTurn,
  opponentName,
  timeLeft,
  timerLow,
  activeColor,
}: {
  isMyTurn: boolean;
  opponentName: string;
  timeLeft: number;
  timerLow: boolean;
  activeColor: string;
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        background: isMyTurn ? "rgba(255,85,64,0.06)" : "rgba(240,160,80,0.06)",
        borderBottom: `1px solid ${isMyTurn ? "rgba(255,85,64,0.2)" : "rgba(240,160,80,0.2)"}`,
        borderTop: `1px solid ${isMyTurn ? "rgba(255,85,64,0.2)" : "rgba(240,160,80,0.2)"}`,
        padding: "6px var(--pad)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        transition: "background 120ms steps(2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            background: activeColor,
            animation: "turnBlink .8s steps(1) infinite",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            color: activeColor,
          }}
        >
          {isMyTurn ? "Your move" : `${opponentName}'s move`}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: -0.5,
          color: timerLow ? "var(--coral)" : "var(--soft)",
          animation: timerLow ? "timerPulse .4s steps(2) infinite" : "none",
        }}
      >
        {String(timeLeft).padStart(2, "0")}s
      </span>
    </div>
  );
}

//  Timer bars
function TimerBars({
  timeLeft,
  timerLow,
  activeColor,
}: {
  timeLeft: number;
  timerLow: boolean;
  activeColor: string;
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        padding: "5px var(--pad)",
        background: "var(--surface-lo)",
        borderBottom: "1px solid var(--rim)",
        display: "flex",
        gap: 3,
      }}
    >
      {Array.from({ length: NUM_BARS }).map((_, i) => {
        const filled = i < Math.ceil((timeLeft / TIMER_SECS) * NUM_BARS);
        const opacity = filled
          ? timerLow
            ? 1 - (i / NUM_BARS) * 0.2
            : 0.45 + (1 - i / NUM_BARS) * 0.45
          : 0.15;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: 14,
              borderRadius: 2,
              background: filled ? activeColor : "var(--surface-hi)",
              opacity,
              transition: "opacity 300ms ease, background 60ms steps(1)",
            }}
          />
        );
      })}
    </div>
  );
}

//  Result card
function ResultCard({
  iWon,
  isDraw,
  mySymbol,
  oppLabel,
  forfeitMsg,
  timeoutMsg,
  board,
  winLine,
  onBack,
}: {
  iWon: boolean;
  isDraw: boolean;
  mySymbol: Player;
  oppLabel: string;
  forfeitMsg: string | null;
  timeoutMsg: string | null;
  board: Cell[];
  winLine: readonly number[] | null;
  onBack: () => void;
}) {
  const winColor = iWon
    ? "var(--coral)"
    : isDraw
      ? "var(--soft)"
      : "var(--amber)";
  const winRgb = iWon ? "255,85,64" : isDraw ? "140,140,130" : "240,160,80";
  const headline = isDraw ? "DRAW" : iWon ? "VICTORY" : "DEFEAT";

  const subLabel = isDraw
    ? "STALEMATE"
    : forfeitMsg
      ? "FORFEIT"
      : timeoutMsg
        ? "TIMEOUT"
        : iWon
          ? "CHAMPION"
          : "ELIMINATED";

  const bodyText = forfeitMsg
    ? forfeitMsg
    : timeoutMsg
      ? timeoutMsg
      : isDraw
        ? "Neither player claimed victory."
        : iWon
          ? `You defeated ${oppLabel}.`
          : `${oppLabel} wins this round.`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 var(--pad)",
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 320,
          background: "var(--surface-lo)",
          border: `1px solid rgba(${winRgb},0.35)`,
          boxShadow: `0 0 0 1px rgba(${winRgb},0.1), 0 24px 48px rgba(0,0,0,0.6), 0 0 60px rgba(${winRgb},0.12)`,
          animation: "resultSlide 200ms steps(4) forwards",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Scanline FX */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "hidden",
            zIndex: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              height: "40%",
              background: `linear-gradient(to bottom, transparent, rgba(${winRgb},0.06), transparent)`,
              animation: "scanline 1.8s steps(12) 1 forwards",
            }}
          />
        </div>

        {/* Top accent bar */}
        <div
          style={{
            height: 3,
            background: isDraw
              ? "linear-gradient(to right, var(--coral), var(--amber))"
              : `linear-gradient(to right, rgba(${winRgb},0.3), ${winColor}, rgba(${winRgb},0.3))`,
          }}
        />

        <div
          style={{ position: "relative", zIndex: 1, padding: "20px 20px 0" }}
        >
          {/* Sub-label */}
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "var(--muted)",
              marginBottom: 14,
            }}
          >
            {subLabel}
          </div>

          {/* Headline */}
          <div style={{ textAlign: "center", paddingBottom: 12 }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 52,
                fontWeight: 900,
                letterSpacing: -2,
                lineHeight: 1,
                background: isDraw
                  ? "linear-gradient(135deg, var(--coral), var(--amber))"
                  : `linear-gradient(135deg, ${winColor}, rgba(${winRgb},0.6))`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {headline}
            </div>
            <p
              className="t-body"
              style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}
            >
              {bodyText}
            </p>
          </div>

          {/* Mini board replay */}
          <div
            style={{
              margin: "4px auto 16px",
              width: 156,
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 2,
              background: "var(--surface-hi)",
              border: "2px solid var(--surface-hi)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            {board.map((cell, i) => {
              const isWin = winLine?.includes(i) ?? false;
              const cellBg = isWin
                ? cell === "X"
                  ? "rgba(255,85,64,0.18)"
                  : "rgba(240,160,80,0.18)"
                : "#161614";
              return (
                <div
                  key={i}
                  style={{
                    width: "100%",
                    aspectRatio: "1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: cellBg,
                    position: "relative",
                    transition: "background 200ms",
                  }}
                >
                  {cell === "X" && (
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 56 56"
                      fill="none"
                      style={{ position: "absolute" }}
                    >
                      <line
                        x1="12"
                        y1="12"
                        x2="44"
                        y2="44"
                        stroke={isWin ? "#ff8060" : "#ff5540"}
                        strokeWidth={isWin ? 7 : 6}
                        strokeLinecap="square"
                      />
                      <line
                        x1="44"
                        y1="12"
                        x2="12"
                        y2="44"
                        stroke={isWin ? "#ff8060" : "#ff5540"}
                        strokeWidth={isWin ? 7 : 6}
                        strokeLinecap="square"
                      />
                    </svg>
                  )}
                  {cell === "O" && (
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 56 56"
                      fill="none"
                      style={{ position: "absolute" }}
                    >
                      <circle
                        cx="28"
                        cy="28"
                        r="17"
                        fill={
                          isWin
                            ? "rgba(240,160,80,.22)"
                            : "rgba(240,160,80,.12)"
                        }
                        stroke={isWin ? "#f4b870" : "#f0a050"}
                        strokeWidth={isWin ? 6 : 5}
                      />
                    </svg>
                  )}
                  {isWin && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background:
                          cell === "X"
                            ? "rgba(255,85,64,0.08)"
                            : "rgba(240,160,80,0.08)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            padding: "0 20px 20px",
            display: "flex",
            gap: 8,
            position: "relative",
            zIndex: 1,
          }}
        >
          <button
            className="btn btn-ghost btn-full"
            onClick={onBack}
            type="button"
          >
            ← Back to menu
          </button>
        </div>
      </div>
    </div>
  );
}

//  Board cell
function BoardCell({
  cell,
  isWin,
  hoverMark,
  onClick,
  disabled,
}: {
  cell: Cell;
  isWin: boolean;
  hoverMark: Player | null;
  onClick: () => void;
  disabled: boolean;
}) {
  const [hov, setHov] = useState(false);
  const bg = isWin
    ? cell === "X"
      ? "rgba(255,85,64,0.13)"
      : "rgba(240,160,80,0.13)"
    : hov && !cell
      ? "#272724"
      : "#161614";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%",
        aspectRatio: "1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: bg,
        cursor: disabled ? "default" : "pointer",
        position: "relative",
        transition: "background 60ms steps(1)",
        padding: 0,
      }}
    >
      {cell === "X" && <XGlyph win={isWin} />}
      {cell === "O" && <OGlyph win={isWin} />}
      {!cell &&
        hov &&
        !disabled &&
        hoverMark &&
        (hoverMark === "X" ? (
          <XGlyph win={false} ghost />
        ) : (
          <OGlyph win={false} ghost />
        ))}
    </button>
  );
}

function XGlyph({ win, ghost }: { win: boolean; ghost?: boolean }) {
  const col = win ? "#ff8060" : "#ff5540";
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      style={{
        animation: ghost ? "none" : "cellIn .1s steps(2) forwards",
        opacity: ghost ? 0.18 : 1,
        position: "absolute",
      }}
    >
      <line
        x1="12"
        y1="12"
        x2="44"
        y2="44"
        stroke={col}
        strokeWidth="6"
        strokeLinecap="square"
      />
      <line
        x1="44"
        y1="12"
        x2="12"
        y2="44"
        stroke={col}
        strokeWidth="6"
        strokeLinecap="square"
      />
    </svg>
  );
}

function OGlyph({ win, ghost }: { win: boolean; ghost?: boolean }) {
  const stroke = win ? "#f4b870" : "#f0a050";
  const fill = win ? "rgba(240,160,80,.22)" : "rgba(240,160,80,.12)";
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      style={{
        animation: ghost ? "none" : "cellIn .1s steps(2) forwards",
        opacity: ghost ? 0.18 : 1,
        position: "absolute",
      }}
    >
      <circle
        cx="28"
        cy="28"
        r="17"
        fill={fill}
        stroke={stroke}
        strokeWidth="5"
      />
    </svg>
  );
}

function Corner({
  pos,
  color,
  dim,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  color: string;
  dim: boolean;
}) {
  const placement: React.CSSProperties =
    pos === "tl"
      ? { top: -14, left: -14 }
      : pos === "tr"
        ? { top: -14, right: -14, transform: "scaleX(-1)" }
        : pos === "bl"
          ? { bottom: -14, left: -14, transform: "scaleY(-1)" }
          : { bottom: -14, right: -14, transform: "scale(-1,-1)" };

  return (
    <div
      style={{
        position: "absolute",
        width: 28,
        height: 28,
        opacity: dim ? 0.35 : 0.9,
        pointerEvents: "none",
        ...placement,
      }}
    >
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M0 26V2C0 .9.9 0 2 0h24" stroke={color} strokeWidth="2.5" />
      </svg>
    </div>
  );
}

//  Player row
function PlayerRow({
  label,
  symbol,
  isMe,
  active,
  log,
  result,
  winner,
  isDraw,
}: {
  label: string;
  symbol: Player;
  isMe: boolean;
  active: boolean;
  log: string[];
  result: Result;
  winner: boolean;
  isDraw: boolean;
}) {
  const color = symbol === "X" ? "var(--coral)" : "var(--amber)";
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollLeft = logRef.current.scrollWidth;
  }, [log]);

  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px var(--pad)",
        minHeight: 60,
        background: winner
          ? symbol === "X"
            ? "rgba(255,85,64,0.1)"
            : "rgba(240,160,80,0.1)"
          : active
            ? "var(--surface-hi)"
            : "var(--surface-lo)",
        borderTop: isMe ? "1px solid var(--rim)" : "none",
        borderBottom: !isMe ? "1px solid var(--rim)" : "none",
        transition: "background 120ms steps(2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            border: `2px solid ${active || winner ? color : "var(--rim)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: active
              ? symbol === "X"
                ? "rgba(255,85,64,.08)"
                : "rgba(240,160,80,.08)"
              : "transparent",
            transition:
              "border-color 120ms steps(2), background 120ms steps(2)",
          }}
        >
          {symbol === "X" ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <line
                x1="4"
                y1="4"
                x2="16"
                y2="16"
                stroke={color}
                strokeWidth="3"
                strokeLinecap="square"
              />
              <line
                x1="16"
                y1="4"
                x2="4"
                y2="16"
                stroke={color}
                strokeWidth="3"
                strokeLinecap="square"
              />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="6" stroke={color} strokeWidth="3" />
            </svg>
          )}
        </div>

        <div>
          <div className="t-label" style={{ color: "var(--muted)" }}>
            {isMe ? "You" : "Opponent"}
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 16,
              fontWeight: 800,
              lineHeight: 1,
              color: active || winner ? color : "var(--soft)",
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        </div>

        {winner && (
          <span
            className="pill"
            style={{
              borderColor: color,
              color,
              fontSize: 8,
              padding: "3px 8px",
              letterSpacing: 2,
            }}
          >
            ▸ Winner
          </span>
        )}
        {isDraw && result === "draw" && (
          <span
            className="pill"
            style={{
              borderColor: "var(--muted)",
              color: "var(--soft)",
              fontSize: 8,
              padding: "3px 8px",
              letterSpacing: 2,
            }}
          >
            Draw
          </span>
        )}
        {!result && active && (
          <span
            className="pill"
            style={{
              borderColor: color,
              color,
              fontSize: 8,
              padding: "3px 8px",
              letterSpacing: 2,
              background:
                symbol === "X" ? "rgba(255,85,64,.08)" : "rgba(240,160,80,.08)",
            }}
          >
            ▸ Active
          </span>
        )}
      </div>

      {/* Move log */}
      <div
        ref={logRef}
        style={{
          flex: 1,
          display: "flex",
          gap: 5,
          overflowX: "auto",
          alignItems: "center",
          justifyContent: "flex-end",
          scrollbarWidth: "none",
          paddingLeft: 6,
        }}
      >
        {log.length === 0 ? (
          <span className="t-label" style={{ color: "var(--muted)" }}>
            no moves
          </span>
        ) : (
          log.map((lbl, i) => (
            <span
              key={i}
              style={{
                flexShrink: 0,
                fontFamily: "var(--font-display)",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                padding: "3px 8px",
                border: "1px solid",
                borderColor:
                  symbol === "X" ? "rgba(255,85,64,.3)" : "rgba(240,160,80,.3)",
                color,
                background:
                  i === log.length - 1
                    ? symbol === "X"
                      ? "rgba(255,85,64,.1)"
                      : "rgba(240,160,80,.1)"
                    : "var(--surface)",
                whiteSpace: "nowrap",
              }}
            >
              {i + 1}. {lbl}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
