import React, { useEffect, useRef, useState, useCallback } from "react";
import { connect, getSocket } from "../../services/nakamaClient";

//  Constants
const OP_STATE = 1;
const TIMER_SECS = 30;

//  Server state shape
interface ServerPlayer {
  userId: string;
  symbol: "X" | "O";
}
interface ServerState {
  board: (string | null)[];
  players: ServerPlayer[];
  turn: string | null;
  winner: string | null;
  moves: number[];
  matchId: string;
}

//  UI types
type Player = "X" | "O";
type Cell = Player | null;
type Result = Player | "draw" | null;

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

function checkWinLine(b: Cell[]): readonly number[] | null {
  for (const line of WIN_LINES) {
    const [a, b1, c] = line;
    if (b[a] && b[a] === b[b1] && b[a] === b[c]) return line;
  }
  return null;
}

//  Logging
const ts = () => new Date().toISOString().slice(11, 23);
const log = {
  info: (m: string, ...d: unknown[]) =>
    console.log(`%c[XO ${ts()}] ${m}`, "color:#22c55e;font-weight:600", ...d),
  warn: (m: string, ...d: unknown[]) =>
    console.warn(`%c[XO ${ts()}] ${m}`, "color:#f59e0b;font-weight:600", ...d),
  error: (m: string, ...d: unknown[]) =>
    console.error(`%c[XO ${ts()}] ${m}`, "color:#ef4444;font-weight:600", ...d),
  state: (label: string, ss: ServerState, myId: string | null) => {
    console.groupCollapsed(
      `%c[XO ${ts()}] 📦 ${label}`,
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

//  Decode binary
function decodeServerState(raw: unknown): ServerState {
  let str: string;
  if (typeof raw === "string") {
    try {
      const binaryStr = atob(raw);
      const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
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

//  Props
interface Props {
  matchId: string;
  opponentName: string;
  iAmX: boolean;
  onBack: () => void;
}

//  Component
export default function OnlineGameScreen({
  matchId,
  opponentName,
  iAmX,
  onBack,
}: Props) {
  const mySymbol: Player = iAmX ? "X" : "O";
  const oppSymbol: Player = iAmX ? "O" : "X";

  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [winLine, setWinLine] = useState<readonly number[] | null>(null);
  const [myMoves, setMyMoves] = useState<string[]>([]);
  const [oppMoves, setOppMoves] = useState<string[]>([]);
  const [connLost, setConnLost] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECS);
  const [forfeitMsg, setForfeitMsg] = useState<string | null>(null);

  const boardRef = useRef<Cell[]>(Array(9).fill(null));
  const myUserIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMyTurnRef = useRef(false);
  const resultRef = useRef<Result>(null);
  const waitingRef = useRef(true);

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
          // Auto-forfeit on timeout — only if still my turn and game ongoing
          if (
            isMyTurnRef.current &&
            !resultRef.current &&
            !waitingRef.current
          ) {
            log.warn("Timer expired — auto-forfeit");
            try {
              const socket = getSocket();
              const payload = new TextEncoder().encode(
                JSON.stringify({ forfeit: true }),
              );
              socket.sendMatchState(matchId, OP_STATE, payload);
            } catch (e) {
              log.error("Auto-forfeit send failed", e);
            }
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearTimer, matchId]);

  //  Apply server state
  const applyServerState = useCallback(
    (ss: ServerState) => {
      const myId = myUserIdRef.current;
      log.state("SERVER STATE", ss, myId);

      const cells = ss.board.map((v) =>
        v === "X" || v === "O" ? (v as Player) : null,
      ) as Cell[];
      boardRef.current = cells;
      setBoard(cells);

      const isWaiting = ss.players.length < 2;
      waitingRef.current = isWaiting;
      setWaiting(isWaiting);
      if (isWaiting) {
        log.warn(`Only ${ss.players.length}/2 players`);
        return;
      }

      const myTurn = !!myId && ss.turn === myId && !ss.winner;
      isMyTurnRef.current = myTurn;
      setIsMyTurn(myTurn);

      setMyMoves(
        ss.moves
          .map((idx) => (cells[idx] === mySymbol ? CELL_LABEL[idx] : null))
          .filter((x): x is string => x !== null),
      );
      setOppMoves(
        ss.moves
          .map((idx) => (cells[idx] === oppSymbol ? CELL_LABEL[idx] : null))
          .filter((x): x is string => x !== null),
      );

      if (ss.winner) {
        clearTimer();
        resultRef.current =
          ss.winner === "draw"
            ? "draw"
            : ss.winner === mySymbol
              ? mySymbol
              : oppSymbol;
        setResult(resultRef.current);
        if (resultRef.current !== "draw") setWinLine(checkWinLine(cells));
        log.info(`Game over — winner: ${ss.winner}`);
      } else {
        // Restart timer on every new state (turn changed)
        startTimer();
      }
    },
    [mySymbol, oppSymbol, clearTimer, startTimer],
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
        log.info(
          `Connected — userId=${session.user_id?.slice(0, 8)} symbol=${mySymbol}`,
        );

        setConnLost(false);
        setReconnecting(false);

        socket.onmatchdata = (data) => {
          if (!mountedRef.current) return;
          log.info(`onmatchdata op=${data.op_code}`);

          if (data.op_code !== OP_STATE) {
            log.warn(`Unknown op_code ${data.op_code} — ignoring`);
            return;
          }

          let ss: ServerState;
          try {
            ss = decodeServerState(data.data);
          } catch (e) {
            log.error("Decode failed", e);
            return;
          }

          applyServerState(ss);
        };

        socket.ondisconnect = () => {
          if (!mountedRef.current) return;
          log.warn("Disconnected — network loss triggers forfeit");
          setConnLost(true);
          clearTimer();

          // Network loss = forfeit, opponent wins
          if (!resultRef.current) {
            setForfeitMsg("Connection lost — opponent wins");
            resultRef.current = oppSymbol;
            setResult(oppSymbol);
          }

          // Still attempt reconnect in background for graceful re-entry
          setReconnecting(true);
          setTimeout(() => {
            if (!mountedRef.current) return;
            setReconnecting(false);
            attach();
          }, 2000);
        };

        // Request resync
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
  }, [matchId, iAmX, mySymbol, applyServerState, clearTimer, oppSymbol]);

  //  Send move
  const handleMove = (idx: number) => {
    if (board[idx] || result || !isMyTurn || connLost || waiting) return;
    log.info(`Move: cell ${idx}`);
    try {
      const socket = getSocket();
      const payload = new TextEncoder().encode(JSON.stringify({ index: idx }));
      socket.sendMatchState(matchId, OP_STATE, payload);
    } catch (e) {
      log.error("sendMatchState failed", e);
      setConnLost(true);
    }
  };

  //  Forfeit
  const handleForfeit = () => {
    log.info("Player forfeited");
    clearTimer();
    try {
      const socket = getSocket();
      const payload = new TextEncoder().encode(
        JSON.stringify({ forfeit: true }),
      );
      socket.sendMatchState(matchId, OP_STATE, payload);
    } catch (e) {
      log.error("Forfeit send failed", e);
    }
    setForfeitMsg("You forfeited — opponent wins");
    resultRef.current = oppSymbol;
    setResult(oppSymbol);
    // Navigate back after brief delay so result card shows
    setTimeout(onBack, 3000);
  };

  //  Derived
  const timerLow = timeLeft <= 10 && isMyTurn && !result && !waiting;
  const activeColor = isMyTurn ? "var(--coral)" : "var(--amber)";

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

      {/* TOPBAR */}
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

      {/* MY ROW */}
      <PlayerRow
        label="You"
        symbol={mySymbol}
        isMe={true}
        active={isMyTurn}
        log={myMoves}
        result={result}
        winner={result === mySymbol}
      />

      {/* TURN STRIP + TIMER */}
      {!result && !waiting && (
        <>
          <div
            style={{
              flexShrink: 0,
              background: isMyTurn
                ? "rgba(255,85,64,0.06)"
                : "rgba(240,160,80,0.06)",
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
            {/* Timer digit */}
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: -0.5,
                color: timerLow ? "var(--coral)" : "var(--soft)",
                animation: timerLow
                  ? "timerPulse .4s steps(2) infinite"
                  : "none",
              }}
            >
              {String(timeLeft).padStart(2, "0")}s
            </span>
          </div>

          {/* Segmented timer bar */}
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
            {Array.from({ length: TIMER_SECS }).map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: isMyTurn ? (timerLow ? 5 : 4) : 4,
                  background: i < timeLeft ? activeColor : "var(--surface-hi)",
                  opacity: i < timeLeft ? (timerLow ? 1 : 0.75) : 0.25,
                  transition: "background 60ms steps(1), height 60ms steps(1)",
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* BOARD */}
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
            {board.map((cell, i) => (
              <BoardCell
                key={i}
                cell={cell}
                isWin={winLine?.includes(i) ?? false}
                hoverMark={
                  isMyTurn && !cell && !result && !waiting ? mySymbol : null
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
            result={result}
            mySymbol={mySymbol}
            oppLabel={opponentName}
            forfeitMsg={forfeitMsg}
            board={board}
            winLine={winLine}
            onBack={onBack}
          />
        )}
      </div>

      {/* OPPONENT ROW */}
      <PlayerRow
        label={opponentName}
        symbol={oppSymbol}
        isMe={false}
        active={!result && !isMyTurn && !waiting}
        log={oppMoves}
        result={result}
        winner={result === oppSymbol}
      />

      {/* FOOTER */}
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
        @keyframes turnBlink  { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes cellIn     { from{transform:scale(.4);opacity:0} to{transform:scale(1);opacity:1} }
        @keyframes resultSlide{ from{transform:translateY(32px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes scanline   { from{transform:translateY(-100%)} to{transform:translateY(100%)} }
        @keyframes timerPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes urgencyPulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,85,64,0)} 50%{box-shadow:0 0 0 8px rgba(255,85,64,0.12)} }
      `}</style>
    </div>
  );
}

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

//  Result Card
function ResultCard({
  result,
  mySymbol,
  oppLabel,
  forfeitMsg,
  board,
  winLine,
  onBack,
}: {
  result: Result;
  mySymbol: Player;
  oppLabel: string;
  forfeitMsg: string | null;
  board: Cell[];
  winLine: readonly number[] | null;
  onBack: () => void;
}) {
  const isDraw = result === "draw";
  const iWon = result === mySymbol;
  const winColor = iWon
    ? "var(--coral)"
    : isDraw
      ? "var(--soft)"
      : "var(--amber)";
  const winRgb = iWon ? "255,85,64" : isDraw ? "140,140,130" : "240,160,80";
  const headline = isDraw ? "DRAW" : iWon ? "VICTORY" : "DEFEAT";

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
            {isDraw ? "STALEMATE" : iWon ? "CHAMPION" : "ELIMINATED"}
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
              {forfeitMsg
                ? forfeitMsg
                : isDraw
                  ? "Neither player claimed victory."
                  : iWon
                    ? `You defeated ${oppLabel}.`
                    : `${oppLabel} wins this round.`}
            </p>
          </div>

          {/* Mini board */}
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
                  {/* Win line highlight dot */}
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

//  Player Row
function PlayerRow({
  label,
  symbol,
  isMe,
  active,
  log,
  result,
  winner,
}: {
  label: string;
  symbol: Player;
  isMe: boolean;
  active: boolean;
  log: string[];
  result: Result;
  winner: boolean;
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
            border: `2px solid ${active || winner ? color : "var(--rim)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
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
        {result === "draw" && (
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
      </div>

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
