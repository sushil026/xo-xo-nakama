import { useEffect, useState } from "react";
import { connect, getRecentMatches } from "../../services/nakamaClient";
import type { StoredMatch } from "../../services/nakamaClient";

interface Props {
  onBack: () => void;
}

const CELL_LABELS = [
  "TL",
  "TM",
  "TR",
  "ML",
  "MM",
  "MR",
  "BL",
  "BM",
  "BR",
] as const;

const PAGE_SIZE = 20;

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function endReasonLabel(reason: StoredMatch["endReason"]): string {
  return (
    { win: "Win", draw: "Draw", timeout: "Timeout", forfeit: "Forfeit" }[
      reason
    ] ?? reason
  );
}

function getWinLine(
  board: ("X" | "O" | null)[],
  winner: string | null,
): number[] {
  if (!winner || winner === "draw") return [];
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] === winner && board[b] === winner && board[c] === winner) {
      return line;
    }
  }
  return [];
}

//  Mini board

function MiniBoard({
  moves,
  winner,
}: {
  moves: number[];
  winner: string | null;
}) {
  const board: ("X" | "O" | null)[] = Array(9).fill(null);
  moves.forEach((cell, idx) => {
    board[cell] = idx % 2 === 0 ? "X" : "O";
  });
  const winLine = getWinLine(board, winner);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3,1fr)",
        gap: 2,
        background: "var(--rim)",
        border: "1px solid var(--rim)",
        borderRadius: 4,
        overflow: "hidden",
        width: 66,
        flexShrink: 0,
        boxShadow: "0 2px 8px rgba(0,0,0,.4)",
      }}
    >
      {board.map((cell, i) => {
        const isWin = winLine.includes(i);
        const bg = isWin
          ? cell === "X"
            ? "rgba(255,85,64,0.18)"
            : "rgba(240,160,80,0.18)"
          : "var(--bg, #161614)";
        return (
          <div
            key={i}
            style={{
              width: "100%",
              aspectRatio: "1",
              background: bg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.2s",
            }}
          >
            {cell === "X" && (
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                <line
                  x1="4"
                  y1="4"
                  x2="16"
                  y2="16"
                  stroke={isWin ? "#ff8060" : "#ff5540"}
                  strokeWidth="2.5"
                  strokeLinecap="square"
                />
                <line
                  x1="16"
                  y1="4"
                  x2="4"
                  y2="16"
                  stroke={isWin ? "#ff8060" : "#ff5540"}
                  strokeWidth="2.5"
                  strokeLinecap="square"
                />
              </svg>
            )}
            {cell === "O" && (
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                <circle
                  cx="10"
                  cy="10"
                  r="6"
                  stroke={isWin ? "#f4b870" : "#f0a050"}
                  strokeWidth="2.5"
                />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

//  Outcome badge

function OutcomeBadge({ outcome }: { outcome: "win" | "loss" | "draw" }) {
  const cfg = {
    win: { label: "WIN", color: "var(--coral)", bg: "rgba(255,85,64,0.10)" },
    loss: { label: "LOSS", color: "var(--amber)", bg: "rgba(240,160,80,0.10)" },
    draw: {
      label: "DRAW",
      color: "var(--muted)",
      bg: "rgba(255,255,255,0.04)",
    },
  }[outcome];

  return (
    <span
      style={{
        fontFamily: "var(--font-display)",
        fontSize: 9,
        fontWeight: 900,
        letterSpacing: 2.5,
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.color}`,
        borderRadius: 2,
        padding: "2px 7px",
        lineHeight: 1,
      }}
    >
      {cfg.label}
    </span>
  );
}

//  Move chip

function MoveChip({
  idx,
  cell,
  mySymbol,
}: {
  idx: number;
  cell: number;
  mySymbol: "X" | "O";
}) {
  const moveSymbol: "X" | "O" = idx % 2 === 0 ? "X" : "O";
  const isMyMove = moveSymbol === mySymbol;
  const color = isMyMove
    ? mySymbol === "X"
      ? "var(--coral)"
      : "var(--amber)"
    : "var(--muted)";
  const border = isMyMove
    ? mySymbol === "X"
      ? "rgba(255,85,64,.35)"
      : "rgba(240,160,80,.35)"
    : "var(--rim)";
  const bg = isMyMove
    ? mySymbol === "X"
      ? "rgba(255,85,64,.08)"
      : "rgba(240,160,80,.08)"
    : "transparent";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--font-display)",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        padding: "3px 8px",
        border: `1px solid ${border}`,
        borderRadius: 2,
        color,
        background: bg,
      }}
    >
      <span style={{ opacity: 0.45 }}>{idx + 1}.</span>
      <span>{moveSymbol}</span>
      <span style={{ opacity: 0.45 }}>→</span>
      <span>{CELL_LABELS[cell]}</span>
    </span>
  );
}

//  Stat pill

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "8px 14px",
        background: "rgba(255,255,255,.03)",
        border: "1px solid var(--rim)",
        borderRadius: 4,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 16,
          fontWeight: 900,
          color: color ?? "var(--soft)",
          lineHeight: 1,
        }}
      >
        {value}
      </span>
    </div>
  );
}

//  Match row

function MatchRow({
  match,
  myUserId,
}: {
  match: StoredMatch;
  myUserId: string;
}) {
  const me = match.players.find((p) => p.userId === myUserId);
  const opp = match.players.find((p) => p.userId !== myUserId);

  const mySymbol = me?.symbol ?? "X";
  const oppName =
    (opp as any)?.username ?? `P_${opp?.userId.slice(0, 4).toUpperCase()}`;

  let outcome: "win" | "loss" | "draw";
  if (match.winner === "draw" || match.winner === null) outcome = "draw";
  else if (match.winner === mySymbol) outcome = "win";
  else outcome = "loss";

  const accentColor =
    outcome === "win"
      ? "var(--coral)"
      : outcome === "loss"
        ? "var(--amber)"
        : "var(--muted)";

  const myFirstMove = match.moves.find((_, idx) =>
    mySymbol === "X" ? idx % 2 === 0 : idx % 2 === 1,
  );

  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        borderBottom: "1px solid var(--rim)",
        borderLeft: `2px solid ${accentColor}`,
        transition: "background 0.15s",
      }}
    >
      {/*  Collapsed row  */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          background: expanded ? "rgba(255,255,255,.025)" : "transparent",
          border: "none",
          padding: "14px var(--pad)",
          display: "flex",
          alignItems: "center",
          gap: 14,
          cursor: "pointer",
          textAlign: "left",
          transition: "background 0.15s",
        }}
      >
        <MiniBoard moves={match.moves} winner={match.winner} />

        {/* Middle: outcome + opponent + date */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginBottom: 6,
            }}
          >
            <OutcomeBadge outcome={outcome} />
            <span
              className="pill"
              style={{
                borderColor: "var(--rim)",
                color: "var(--muted)",
                fontSize: 8,
                padding: "2px 6px",
                letterSpacing: 1.5,
              }}
            >
              {endReasonLabel(match.endReason)}
            </span>
          </div>

          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 13,
              fontWeight: 700,
              color: "var(--soft)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: 4,
            }}
          >
            vs {oppName}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="t-label" style={{ color: "var(--muted)" }}>
              {formatDate(match.createdAt)}
            </span>
            <span
              style={{
                width: 3,
                height: 3,
                borderRadius: "50%",
                background: "var(--rim)",
                flexShrink: 0,
              }}
            />
            <span className="t-label" style={{ color: "var(--muted)" }}>
              {match.moves.length} moves
            </span>
          </div>
        </div>

        {/* Right: symbol + chevron */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 4,
              border: `1px solid ${mySymbol === "X" ? "rgba(255,85,64,.3)" : "rgba(240,160,80,.3)"}`,
              background:
                mySymbol === "X"
                  ? "rgba(255,85,64,.08)"
                  : "rgba(240,160,80,.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display)",
              fontSize: 16,
              fontWeight: 900,
              color: mySymbol === "X" ? "var(--coral)" : "var(--amber)",
              lineHeight: 1,
            }}
          >
            {mySymbol}
          </div>
          <span
            style={{
              fontSize: 8,
              color: "var(--muted)",
              fontFamily: "var(--font-display)",
              transition: "transform 0.2s",
              display: "block",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            ▼
          </span>
        </div>
      </button>

      {/*  Expanded detail  */}
      {expanded && (
        <div
          style={{
            padding: "0 var(--pad) 16px",
            borderTop: "1px solid var(--rim)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Quick stats */}
          <div
            style={{
              display: "flex",
              gap: 8,
              paddingTop: 14,
              flexWrap: "wrap",
            }}
          >
            {myFirstMove !== undefined && (
              <StatPill
                label="Your opening"
                value={CELL_LABELS[myFirstMove]}
                color={accentColor}
              />
            )}
            <StatPill label="Total moves" value={match.moves.length} />
            <StatPill
              label="Played as"
              value={mySymbol}
              color={mySymbol === "X" ? "var(--coral)" : "var(--amber)"}
            />
          </div>

          {/* Move sequence */}
          <div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: "var(--muted)",
                marginBottom: 9,
              }}
            >
              Move sequence
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {match.moves.length === 0 ? (
                <span className="t-label" style={{ color: "var(--muted)" }}>
                  No moves recorded
                </span>
              ) : (
                match.moves.map((cell, idx) => (
                  <MoveChip
                    key={idx}
                    idx={idx}
                    cell={cell}
                    mySymbol={mySymbol}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

//  Summary bar

function SummaryBar({
  matches,
  myUserId,
}: {
  matches: StoredMatch[];
  myUserId: string;
}) {
  let wins = 0,
    losses = 0,
    draws = 0;
  for (const m of matches) {
    const me = m.players.find((p) => p.userId === myUserId);
    const mySymbol = me?.symbol ?? "X";
    if (m.winner === "draw" || m.winner === null) draws++;
    else if (m.winner === mySymbol) wins++;
    else losses++;
  }
  const total = matches.length;
  const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;

  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderBottom: "1px solid var(--rim)",
        background: "rgba(255,255,255,.02)",
        flexShrink: 0,
      }}
    >
      {[
        { label: "W", value: wins, color: "var(--coral)" },
        { label: "L", value: losses, color: "var(--amber)" },
        { label: "D", value: draws, color: "var(--muted)" },
        { label: "WIN%", value: `${winPct}%`, color: "var(--soft)" },
      ].map(({ label, value, color }, i, arr) => (
        <div
          key={label}
          style={{
            flex: 1,
            padding: "10px 0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            borderRight: i < arr.length - 1 ? "1px solid var(--rim)" : "none",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 7,
              fontWeight: 700,
              letterSpacing: 2.5,
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 900,
              color,
              lineHeight: 1,
            }}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

//  Empty state

function EmptyState() {
  return (
    <>
      <style>{`
        @keyframes es-fade {
          0%   { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0);   }
        }
        @keyframes es-draw {
          0%   { stroke-dashoffset: 40; opacity: 0; }
          30%  { opacity: 1; }
          100% { stroke-dashoffset: 0;  opacity: 1; }
        }
        @keyframes es-pulse {
          0%, 100% { opacity: 0.25; }
          50%      { opacity: 0.55; }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "absolute",
          inset: 0, // ← full screen
          gap: 18,
          zIndex: 1,
          animation: "es-fade 0.5s ease both",
        }}
      >
        {/* Animated ghost board */}
        <div style={{ position: "relative", width: 72, height: 72 }}>
          <svg
            width="72"
            height="72"
            viewBox="0 0 72 72"
            style={{ animation: "es-pulse 3s ease-in-out infinite" }}
          >
            {/* Grid lines */}
            <line
              x1="24"
              y1="5"
              x2="24"
              y2="67"
              stroke="var(--rim)"
              strokeWidth="1.5"
            />
            <line
              x1="48"
              y1="5"
              x2="48"
              y2="67"
              stroke="var(--rim)"
              strokeWidth="1.5"
            />
            <line
              x1="5"
              y1="24"
              x2="67"
              y2="24"
              stroke="var(--rim)"
              strokeWidth="1.5"
            />
            <line
              x1="5"
              y1="48"
              x2="67"
              y2="48"
              stroke="var(--rim)"
              strokeWidth="1.5"
            />

            {/* Ghost X marks — faint, scattered */}
            {/* cell 0 — X */}
            <line
              x1="9"
              y1="9"
              x2="19"
              y2="19"
              stroke="rgba(255,85,64,0.18)"
              strokeWidth="2"
              strokeLinecap="square"
            />
            <line
              x1="19"
              y1="9"
              x2="9"
              y2="19"
              stroke="rgba(255,85,64,0.18)"
              strokeWidth="2"
              strokeLinecap="square"
            />
            {/* cell 4 — O */}
            <circle
              cx="36"
              cy="36"
              r="7"
              stroke="rgba(240,160,80,0.18)"
              strokeWidth="2"
              fill="none"
            />
            {/* cell 8 — X */}
            <line
              x1="53"
              y1="53"
              x2="63"
              y2="63"
              stroke="rgba(255,85,64,0.18)"
              strokeWidth="2"
              strokeLinecap="square"
            />
            <line
              x1="63"
              y1="53"
              x2="53"
              y2="63"
              stroke="rgba(255,85,64,0.18)"
              strokeWidth="2"
              strokeLinecap="square"
            />
            {/* cell 2 — O */}
            <circle
              cx="60"
              cy="12"
              r="7"
              stroke="rgba(240,160,80,0.18)"
              strokeWidth="2"
              fill="none"
            />
            {/* cell 6 — X */}
            <line
              x1="9"
              y1="53"
              x2="19"
              y2="63"
              stroke="rgba(255,85,64,0.18)"
              strokeWidth="2"
              strokeLinecap="square"
            />
            <line
              x1="19"
              y1="53"
              x2="9"
              y2="63"
              stroke="rgba(255,85,64,0.18)"
              strokeWidth="2"
              strokeLinecap="square"
            />

            {/* Animated strike-through diagonal — "no games" slash */}
            <line
              x1="6"
              y1="6"
              x2="66"
              y2="66"
              stroke="rgba(255,85,64,0.35)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="40"
              strokeDashoffset="40"
              style={{
                animation: "es-draw 1s 0.3s cubic-bezier(.4,0,.2,1) forwards",
              }}
            />
          </svg>
        </div>

        {/* Text */}
        <div
          style={{
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            No matches yet
          </div>
          <div
            className="t-label"
            style={{ color: "var(--muted)", opacity: 0.55 }}
          >
            Play your first game to see history here
          </div>
        </div>
      </div>
    </>
  );
}

function LoadingState() {
  return (
    <>
      <style>{`
        @keyframes cell-fill {
          0%, 100% { opacity: 0.08; transform: scale(0.7); }
          50%       { opacity: 1;    transform: scale(1);   }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 16,
          position: "absolute",
          inset: 0,
          zIndex: 1,
        }}
      >
        <div style={{ position: "relative", width: 64, height: 64 }}>
          {/* Grid lines — static ghost */}
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            {/* vertical lines */}
            <line
              x1="21"
              y1="4"
              x2="21"
              y2="60"
              stroke="var(--rim)"
              strokeWidth="1.5"
            />
            <line
              x1="43"
              y1="4"
              x2="43"
              y2="60"
              stroke="var(--rim)"
              strokeWidth="1.5"
            />
            {/* horizontal lines */}
            <line
              x1="4"
              y1="21"
              x2="60"
              y2="21"
              stroke="var(--rim)"
              strokeWidth="1.5"
            />
            <line
              x1="4"
              y1="43"
              x2="60"
              y2="43"
              stroke="var(--rim)"
              strokeWidth="1.5"
            />
          </svg>

          {/* 9 cells — each animates with staggered delay */}
          {[
            // [col, row, symbol, delay]
            [0, 0, "X", 0],
            [2, 1, "X", 0.18],
            [1, 2, "X", 0.36],
            [1, 0, "O", 0.54],
            [0, 1, "O", 0.72],
            [2, 0, "O", 0.9],
          ].map(([col, row, sym, delay], i) => {
            const cx = (col as number) * 22 + 11;
            const cy = (row as number) * 22 + 11;
            const color = sym === "X" ? "#ff5540" : "#f0a050";
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: cx - 7,
                  top: cy - 7,
                  width: 14,
                  height: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  animation: `cell-fill 1.4s ease-in-out ${delay}s infinite`,
                }}
              >
                {sym === "X" ? (
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                    <line
                      x1="4"
                      y1="4"
                      x2="16"
                      y2="16"
                      stroke={color}
                      strokeWidth="2.8"
                      strokeLinecap="square"
                    />
                    <line
                      x1="16"
                      y1="4"
                      x2="4"
                      y2="16"
                      stroke={color}
                      strokeWidth="2.8"
                      strokeLinecap="square"
                    />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                    <circle
                      cx="10"
                      cy="10"
                      r="6"
                      stroke={color}
                      strokeWidth="2.8"
                    />
                  </svg>
                )}
              </div>
            );
          })}
        </div>

        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          Loading
        </span>
      </div>
    </>
  );
}

//  Main screen
export default function MatchHistoryScreen({ onBack }: Props) {
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { session } = await connect();
        const recent = await getRecentMatches(session, PAGE_SIZE * 5);
        if (!alive) return;
        setMatches(recent.sort((a, b) => b.createdAt - a.createdAt));
        setMyUserId(session.user_id ?? null);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  const visible = matches.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < matches.length;

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

      {/*  Topbar  */}
      <header className="topbar" style={{ flexShrink: 0 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack} type="button">
          ←
        </button>
        <div className="topbar-logo">
          HISTORY<span className="topbar-logo-accent">.</span>
        </div>
        <span
          className="pill"
          style={{
            borderColor: "var(--soft)",
            color: "var(--soft)",
            fontSize: 9,
          }}
        >
          {loading ? "—" : `${matches.length} games`}
        </span>
      </header>

      {/*  Summary bar (only when data loaded)  */}
      {!loading && myUserId && matches.length > 0 && (
        <SummaryBar matches={matches} myUserId={myUserId} />
      )}

      {/*  List  */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch" as const,
        }}
      >
        {loading && <LoadingState />}

        {!loading && matches.length === 0 && <EmptyState />}

        {!loading &&
          myUserId &&
          visible.map((match) => (
            <MatchRow key={match.matchId} match={match} myUserId={myUserId} />
          ))}

        {hasMore && !loading && (
          <div style={{ padding: "16px var(--pad)" }}>
            <button
              className="btn btn-ghost btn-full"
              type="button"
              onClick={() => setPage((p) => p + 1)}
            >
              Load more ↓
            </button>
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
