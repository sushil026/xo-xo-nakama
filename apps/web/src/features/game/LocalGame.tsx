import React, { useEffect, useRef, useState } from "react";

type Player = "X" | "O";
type Cell = Player | null;
type Result = Player | "draw" | null;

const TIMER_SECS = 15;
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

function checkWinner(b: Cell[]): {
  winner: Result;
  line: readonly number[] | null;
} {
  for (const line of WIN_LINES) {
    const [a, b1, c] = line;
    if (b[a] && b[a] === b[b1] && b[a] === b[c])
      return { winner: b[a] as Player, line };
  }
  if (!b.includes(null)) return { winner: "draw", line: null };
  return { winner: null, line: null };
}

export default function LocalGameScreen({ onBack }: { onBack: () => void }) {
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [turn, setTurn] = useState<Player>("X");
  const [result, setResult] = useState<Result>(null);
  const [winLine, setWinLine] = useState<readonly number[] | null>(null);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECS);
  const [scores, setScores] = useState({ X: 0, O: 0 });
  const [logX, setLogX] = useState<string[]>([]);
  const [logO, setLogO] = useState<string[]>([]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startTimer = () => {
    stopTimer();
    setTimeLeft(TIMER_SECS);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          stopTimer();
          setTurn((t) => {
            const next: Player = t === "X" ? "O" : "X";
            setTimeout(() => startTimer(), 0);
            return next;
          });
          return TIMER_SECS;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    startTimer();
    return stopTimer;
  }, []); // eslint-disable-line
  useEffect(() => {
    if (result) stopTimer();
  }, [result]);

  const handleMove = (idx: number) => {
    if (board[idx] || result) return;
    const next = [...board] as Cell[];
    next[idx] = turn;
    const label = CELL_LABEL[idx];
    if (turn === "X") setLogX((l) => [...l, label]);
    else setLogO((l) => [...l, label]);
    const { winner, line } = checkWinner(next);
    setBoard(next);
    if (winner) {
      setResult(winner);
      setWinLine(line);
      if (winner !== "draw")
        setScores((s) => ({ ...s, [winner]: s[winner as Player] + 1 }));
    } else {
      setTurn(turn === "X" ? "O" : "X");
      startTimer();
    }
  };

  const resetGame = () => {
    setBoard(Array(9).fill(null));
    setTurn("X");
    setResult(null);
    setWinLine(null);
    setLogX([]);
    setLogO([]);
    startTimer();
  };

  const timerLow = timeLeft <= 5 && !result;
  const activeColor = turn === "X" ? "var(--coral)" : "var(--amber)";

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
            borderColor: "var(--amber)",
            color: "var(--amber)",
            fontSize: 9,
          }}
        >
          Local
        </span>
      </header>

      {/* PLAYER O — pinned */}
      <PlayerRow
        player="O"
        active={!result && turn === "O"}
        score={scores.O}
        log={logO}
        result={result}
      />

      {/* TURN INDICATOR STRIP — only while playing */}
      {!result && (
        <div
          style={{
            flexShrink: 0,
            background:
              turn === "X" ? "rgba(255,85,64,0.06)" : "rgba(240,160,80,0.06)",
            borderBottom: `1px solid ${turn === "X" ? "rgba(255,85,64,0.2)" : "rgba(240,160,80,0.2)"}`,
            borderTop: `1px solid ${turn === "X" ? "rgba(255,85,64,0.2)" : "rgba(240,160,80,0.2)"}`,
            padding: "6px var(--pad)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            transition:
              "background 120ms steps(2), border-color 120ms steps(2)",
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
              Player {turn} — your move
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
      )}

      {/* TIMER BAR — only while playing */}
      {!result && (
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
                height: 4,
                background: i < timeLeft ? activeColor : "var(--surface-hi)",
                opacity: i < timeLeft ? (timerLow ? 1 : 0.75) : 0.25,
                transition: "background 60ms steps(1)",
              }}
            />
          ))}
        </div>
      )}

      {/* BOARD + RESULT OVERLAY — scrollable middle */}
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
        {/* board always rendered, dims on result */}
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
              boxShadow: "0 0 40px rgba(255,85,64,0.08)",
            }}
          >
            {board.map((cell, i) => (
              <BoardCell
                key={i}
                cell={cell}
                isWin={winLine?.includes(i) ?? false}
                hoverMark={!result && cell === null ? turn : null}
                onClick={() => handleMove(i)}
                disabled={!!cell || !!result}
              />
            ))}
          </div>
        </div>

        {/* RESULT CARD — slides up over dimmed board */}
        {result && (
          <ResultCard
            result={result}
            winLine={winLine}
            board={board}
            scores={scores}
            onPlayAgain={resetGame}
            onBack={onBack}
          />
        )}
      </div>

      {/* PLAYER X — pinned */}
      <PlayerRow
        player="X"
        active={!result && turn === "X"}
        score={scores.X}
        log={logX}
        result={result}
      />

      {/* FOOTER */}
      <footer style={{ padding: "12px var(--pad)", flexShrink: 0 }}>
        <div className="prog-bar" style={{ marginBottom: 12 }} />
        <button
          className="btn btn-ghost btn-full"
          onClick={onBack}
          type="button"
        >
          ← Abort mission
        </button>
      </footer>

      <style>{`
        @keyframes timerPulse  { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes turnBlink   { 0%,100%{opacity:1} 50%{opacity:0}  }
        @keyframes cellIn      { from{transform:scale(.4);opacity:0} to{transform:scale(1);opacity:1} }
        @keyframes resultSlide { from{transform:translateY(32px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes scanline    { from{transform:translateY(-100%)} to{transform:translateY(100%)} }
      `}</style>
    </div>
  );
}

// ─── Result card — online-style with board replay ────────────────────────────
function ResultCard({
  result,
  winLine,
  board,
  scores,
  onPlayAgain,
  onBack,
}: {
  result: Result;
  winLine: readonly number[] | null;
  board: Cell[];
  scores: { X: number; O: number };
  onPlayAgain: () => void;
  onBack: () => void;
}) {
  const isDraw = result === "draw";
  const winner = isDraw ? null : (result as Player);
  const loser: Player | null =
    winner === "X" ? "O" : winner === "O" ? "X" : null;

  const winColor =
    winner === "X"
      ? "var(--coral)"
      : winner === "O"
        ? "var(--amber)"
        : "var(--soft)";
  const winRgb =
    winner === "X"
      ? "255,85,64"
      : winner === "O"
        ? "240,160,80"
        : "140,140,130";

  const headline = isDraw ? "DRAW" : winner === "X" ? "VICTORY" : "VICTORY";
  const subLabel = isDraw ? "STALEMATE" : "CHAMPION";
  const bodyText = isDraw
    ? "Neither player claimed victory."
    : `Player ${winner} wins this round.`;

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

          {/* Score row */}
          {!isDraw && winner && loser && (
            <div
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 12,
              }}
            >
              {/* Winner block */}
              <div
                style={{
                  flex: 1,
                  background: `rgba(${winRgb},0.07)`,
                  border: `1px solid rgba(${winRgb},0.2)`,
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    flexShrink: 0,
                    border: `2px solid ${winColor}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `rgba(${winRgb},0.1)`,
                  }}
                >
                  {winner === "X" ? (
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <line
                        x1="4"
                        y1="4"
                        x2="16"
                        y2="16"
                        stroke={winColor}
                        strokeWidth="3"
                        strokeLinecap="square"
                      />
                      <line
                        x1="16"
                        y1="4"
                        x2="4"
                        y2="16"
                        stroke={winColor}
                        strokeWidth="3"
                        strokeLinecap="square"
                      />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <circle
                        cx="10"
                        cy="10"
                        r="6"
                        stroke={winColor}
                        strokeWidth="3"
                      />
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      marginBottom: 2,
                    }}
                  >
                    Victor
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 18,
                      fontWeight: 900,
                      letterSpacing: -0.5,
                      lineHeight: 1,
                      color: winColor,
                    }}
                  >
                    Player {winner}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 24,
                    fontWeight: 900,
                    color: winColor,
                  }}
                >
                  {scores[winner]}
                </div>
              </div>

              {/* Loser block */}
              <div
                style={{
                  flex: 1,
                  border: "1px solid var(--rim)",
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  opacity: 0.5,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    flexShrink: 0,
                    border: "2px solid var(--rim)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {loser === "X" ? (
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <line
                        x1="4"
                        y1="4"
                        x2="16"
                        y2="16"
                        stroke="var(--muted)"
                        strokeWidth="3"
                        strokeLinecap="square"
                      />
                      <line
                        x1="16"
                        y1="4"
                        x2="4"
                        y2="16"
                        stroke="var(--muted)"
                        strokeWidth="3"
                        strokeLinecap="square"
                      />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <circle
                        cx="10"
                        cy="10"
                        r="6"
                        stroke="var(--muted)"
                        strokeWidth="3"
                      />
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      marginBottom: 2,
                    }}
                  >
                    Defeated
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 16,
                      fontWeight: 800,
                      letterSpacing: -0.5,
                      color: "var(--soft)",
                    }}
                  >
                    Player {loser}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 20,
                    fontWeight: 800,
                    color: "var(--muted)",
                  }}
                >
                  {scores[loser]}
                </div>
              </div>
            </div>
          )}

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

        {/* Action buttons */}
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
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={onPlayAgain}
            type="button"
          >
            ↻ Play again
          </button>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={onBack}
            type="button"
          >
            ← Exit
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Board cell ───────────────────────────────────────────────────────────────
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

// ─── Player row ───────────────────────────────────────────────────────────────
function PlayerRow({
  player,
  active,
  score,
  log,
  result,
}: {
  player: Player;
  active: boolean;
  score: number;
  log: string[];
  result: Result;
}) {
  const color = player === "X" ? "var(--coral)" : "var(--amber)";
  const isWinner = result === player;
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
        background: isWinner
          ? player === "X"
            ? "rgba(255,85,64,0.1)"
            : "rgba(240,160,80,0.1)"
          : active
            ? "var(--surface-hi)"
            : "var(--surface-lo)",
        borderTop: player === "X" ? "1px solid var(--rim)" : "none",
        borderBottom: player === "O" ? "1px solid var(--rim)" : "none",
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
            border: `2px solid ${active || isWinner ? color : "var(--rim)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            background: active
              ? player === "X"
                ? "rgba(255,85,64,.08)"
                : "rgba(240,160,80,.08)"
              : "transparent",
            transition:
              "border-color 120ms steps(2), background 120ms steps(2)",
          }}
        >
          {player === "X" ? (
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
            Player {player}
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              fontWeight: 800,
              lineHeight: 1,
              color: active || isWinner ? color : "var(--soft)",
              transition: "color 120ms steps(2)",
            }}
          >
            {score}
          </div>
        </div>

        {isWinner && (
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
                player === "X" ? "rgba(255,85,64,.08)" : "rgba(240,160,80,.08)",
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

      {/* move log */}
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
          log.map((label, i) => (
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
                  player === "X" ? "rgba(255,85,64,.3)" : "rgba(240,160,80,.3)",
                color,
                background:
                  i === log.length - 1
                    ? player === "X"
                      ? "rgba(255,85,64,.1)"
                      : "rgba(240,160,80,.1)"
                    : "var(--surface)",
                whiteSpace: "nowrap",
              }}
            >
              {i + 1}. {label}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
