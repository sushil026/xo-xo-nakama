import { useEffect, useRef, useState, useCallback } from "react";
import {
  connect,
  getProfile,
  getAnalytics,
  getRatingHistory,
} from "../../services/nakamaClient";
import type {
  UserProfile,
  UserAnalytics,
  RatingPoint,
} from "../../services/nakamaClient";
import RatingGraph from "./RatingGraph";

interface Props {
  onBack: () => void;
  onMatchHistory: () => void;
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
type HeatmapMode = "opening" | "activity";

//  Helpers

function dominantOutcome(
  wld: [number, number, number],
): "coral" | "amber" | "muted" {
  const [w, l, d] = wld;
  const total = w + l + d;
  if (total === 0) return "muted";
  if (w >= l && w >= d) return "coral";
  if (l > w && l >= d) return "amber";
  return "muted";
}

const RGB_MAP = {
  coral: [255, 85, 64] as const,
  amber: [240, 160, 80] as const,
  muted: [140, 140, 130] as const,
};

function bestOpening(data: [number, number, number][]) {
  let bestCell: number | null = null,
    bestWinRate = -1;
  let worstCell: number | null = null,
    worstWinRate = Infinity;
  data.forEach(([w, l, d], i) => {
    const total = w + l + d;
    if (total < 2) return;
    const wr = w / total;
    if (wr > bestWinRate) {
      bestWinRate = wr;
      bestCell = i;
    }
    if (wr < worstWinRate) {
      worstWinRate = wr;
      worstCell = i;
    }
  });
  return {
    bestCell,
    bestWinRate: bestCell !== null ? Math.round(bestWinRate * 100) : 0,
    worstCell,
    worstWinRate: worstCell !== null ? Math.round(worstWinRate * 100) : 0,
  };
}

//  Thermal Canvas Heatmap

function ThermalHeatmap({
  openingData,
  activityData,
}: {
  openingData: [number, number, number][];
  activityData: [number, number, number][];
}) {
  const [mode, setMode] = useState<HeatmapMode>("opening");
  const heatRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef<HTMLCanvasElement>(null);

  const SIZE = 270;

  const draw = useCallback(() => {
    const heatCanvas = heatRef.current;
    const labelCanvas = labelRef.current;
    const scaleCanvas = scaleRef.current;
    if (!heatCanvas || !labelCanvas || !scaleCanvas) return;

    const data = mode === "opening" ? openingData : activityData;
    const isOpening = mode === "opening";
    const hCtx = heatCanvas.getContext("2d")!;
    const lCtx = labelCanvas.getContext("2d")!;
    const sCtx = scaleCanvas.getContext("2d")!;
    const W = heatCanvas.width;
    const CELL = W / 3;
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    // Heat layer
    hCtx.clearRect(0, 0, W, W);
    hCtx.fillStyle = isDark ? "#1a1a18" : "#f0ede8";
    hCtx.fillRect(0, 0, W, W);

    const totals = data.map(([w, l, d]) => w + l + d);
    const maxTotal = Math.max(...totals, 1);

    data.forEach(([w, l, d], i) => {
      const total = w + l + d;
      const col = i % 3;
      const row = Math.floor(i / 3);
      const cx = col * CELL + CELL / 2;
      const cy = row * CELL + CELL / 2;

      if (total === 0) {
        hCtx.fillStyle = isDark ? "#222220" : "#e8e5e0";
        hCtx.fillRect(col * CELL + 1, row * CELL + 1, CELL - 2, CELL - 2);
      } else {
        const key = isOpening ? dominantOutcome([w, l, d]) : "coral";
        const [r, g, b] = RGB_MAP[key];
        const intensity = isOpening ? w / total : total / maxTotal;
        const baseAlpha = 0.15 + intensity * 0.75;
        const blobR = CELL * (0.35 + intensity * 0.28);

        const blob = (
          bx: number,
          by: number,
          radius: number,
          alpha: number,
        ) => {
          const grad = hCtx.createRadialGradient(bx, by, 0, bx, by, radius);
          grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
          grad.addColorStop(0.4, `rgba(${r},${g},${b},${alpha * 0.65})`);
          grad.addColorStop(0.75, `rgba(${r},${g},${b},${alpha * 0.2})`);
          grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
          hCtx.fillStyle = grad;
          hCtx.beginPath();
          hCtx.ellipse(bx, by, radius * 1.1, radius * 0.85, 0, 0, Math.PI * 2);
          hCtx.fill();
        };

        hCtx.save();
        hCtx.beginPath();
        hCtx.rect(col * CELL + 1, row * CELL + 1, CELL - 2, CELL - 2);
        hCtx.clip();
        blob(cx, cy, blobR, baseAlpha);
        if (intensity > 0.55) blob(cx, cy, blobR * 0.45, baseAlpha * 0.6);
        hCtx.restore();
      }

      hCtx.strokeStyle = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.09)";
      hCtx.lineWidth = 1;
      hCtx.strokeRect(col * CELL + 0.5, row * CELL + 0.5, CELL, CELL);
    });

    // Label layer
    lCtx.clearRect(0, 0, W, W);
    data.forEach(([w, l, d], i) => {
      const total = w + l + d;
      const col = i % 3;
      const row = Math.floor(i / 3);
      const cx = col * CELL + CELL / 2;
      const cy = row * CELL + CELL / 2;

      lCtx.font = "500 10px system-ui,sans-serif";
      lCtx.fillStyle = isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.28)";
      lCtx.textAlign = "left";
      lCtx.fillText(CELL_LABELS[i], col * CELL + 6, row * CELL + 13);

      if (total > 0) {
        const textColor = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.85)";
        const subColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
        const primary = isOpening
          ? `${Math.round((w / total) * 100)}%`
          : String(total);

        lCtx.font = `700 ${isOpening ? 18 : 20}px system-ui,sans-serif`;
        lCtx.fillStyle = textColor;
        lCtx.textAlign = "center";
        lCtx.fillText(primary, cx, cy + 6);

        lCtx.font = "400 9px system-ui,sans-serif";
        lCtx.fillStyle = subColor;
        lCtx.fillText(`${w}W  ${l}L  ${d}D`, cx, cy + 19);
      } else {
        lCtx.font = "500 13px system-ui,sans-serif";
        lCtx.fillStyle = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
        lCtx.textAlign = "center";
        lCtx.fillText("—", cx, cy + 5);
      }
    });

    // Scale bar
    const grad = sCtx.createLinearGradient(0, 0, scaleCanvas.width, 0);
    grad.addColorStop(0, "rgba(255,85,64,0.07)");
    grad.addColorStop(0.4, "rgba(255,85,64,0.38)");
    grad.addColorStop(0.75, "rgba(255,85,64,0.65)");
    grad.addColorStop(1, "rgba(255,85,64,0.92)");
    sCtx.clearRect(0, 0, scaleCanvas.width, scaleCanvas.height);
    sCtx.fillStyle = grad;
    sCtx.beginPath();
    sCtx.roundRect(0, 0, scaleCanvas.width, scaleCanvas.height, 3);
    sCtx.fill();
  }, [mode, openingData, activityData]);

  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", draw);
    return () => mq.removeEventListener("change", draw);
  }, [draw]);

  const isOpening = mode === "opening";

  return (
    <div>
      {/* Tab switcher */}
      <div
        style={{
          display: "flex",
          background: "var(--surface-hi)",
          border: "1px solid var(--rim)",
          marginBottom: 16,
          overflow: "hidden",
        }}
      >
        {(["opening", "activity"] as HeatmapMode[]).map((m, idx) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: "8px 0",
                border: "none",
                borderRight: idx === 0 ? "1px solid var(--rim)" : "none",
                background: active ? "rgba(255,85,64,0.1)" : "transparent",
                cursor: "pointer",
                transition: "background 120ms steps(2)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 2.5,
                  textTransform: "uppercase",
                  color: active ? "var(--coral)" : "var(--muted)",
                }}
              >
                {m === "opening" ? "First Move" : "All Moves"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Subtitle */}
      <div
        className="t-label"
        style={{ color: "var(--muted)", marginBottom: 14 }}
      >
        {isOpening
          ? "Win rate when you opened on each cell — brighter = better"
          : "How often you played each cell across all games"}
      </div>

      {/* Axis labels + canvas */}
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {/* Row axis */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 44,
            flexShrink: 0,
            paddingTop: 24,
          }}
        >
          {["Top", "Mid", "Bot"].map((lbl) => (
            <div
              key={lbl}
              style={{
                height: SIZE / 3,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                paddingRight: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: "var(--muted)",
                }}
              >
                {lbl}
              </span>
            </div>
          ))}
        </div>

        {/* Col axis + canvas */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Col labels */}
          <div
            style={{
              display: "flex",
              width: SIZE,
              height: 20,
              marginBottom: 4,
            }}
          >
            {["Left", "Mid", "Right"].map((lbl) => (
              <div
                key={lbl}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: "var(--muted)",
                  }}
                >
                  {lbl}
                </span>
              </div>
            ))}
          </div>

          {/* Canvas stack */}
          <div style={{ position: "relative", width: SIZE, height: SIZE }}>
            <canvas
              ref={heatRef}
              width={SIZE}
              height={SIZE}
              style={{ display: "block", borderRadius: 3 }}
            />
            <canvas
              ref={labelRef}
              width={SIZE}
              height={SIZE}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                pointerEvents: "none",
              }}
            />
          </div>
        </div>
      </div>

      {/* Scale bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 10,
          marginLeft: 44,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 9,
            color: "var(--muted)",
            flexShrink: 0,
          }}
        >
          {isOpening ? "0%" : "Low"}
        </span>
        <canvas
          ref={scaleRef}
          width={200}
          height={8}
          style={{ flex: 1, borderRadius: 3 }}
        />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 9,
            color: "var(--muted)",
            flexShrink: 0,
          }}
        >
          {isOpening ? "100%" : "High"}
        </span>
      </div>

      {/* Legend — opening only */}
      {isOpening && (
        <div
          style={{ display: "flex", gap: 14, marginTop: 10, marginLeft: 44 }}
        >
          {(["coral", "amber", "muted"] as const).map((key) => {
            const [r, g, b] = RGB_MAP[key];
            return (
              <div
                key={key}
                style={{ display: "flex", alignItems: "center", gap: 5 }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    background: `rgba(${r},${g},${b},0.75)`,
                    flexShrink: 0,
                  }}
                />
                <span className="t-label" style={{ color: "var(--muted)" }}>
                  {key === "coral"
                    ? "Win-heavy"
                    : key === "amber"
                      ? "Loss-heavy"
                      : "Draw"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

//  Stat Cell

function StatCell({
  value,
  label,
  color = "var(--soft)",
}: {
  value: number | string;
  label: string;
  color?: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 900,
          letterSpacing: -1,
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div className="t-label" style={{ marginTop: 3, color: "var(--muted)" }}>
        {label}
      </div>
    </div>
  );
}

//  Insight Cards

function InsightCard({
  label,
  cellLabel,
  winRate,
  variant,
}: {
  label: string;
  cellLabel: string;
  winRate: number;
  variant: "coral" | "amber";
}) {
  const color = variant === "coral" ? "var(--coral)" : "var(--amber)";
  const [r, g, b] = RGB_MAP[variant];
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: `rgba(${r},${g},${b},0.06)`,
        border: `1px solid rgba(${r},${g},${b},0.2)`,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            color: "var(--muted)",
            marginBottom: 3,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            fontWeight: 900,
            color,
          }}
        >
          {cellLabel}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 20,
            fontWeight: 900,
            color,
            lineHeight: 1,
          }}
        >
          {winRate}%
        </div>
        <div className="t-label" style={{ color: "var(--muted)" }}>
          win rate
        </div>
      </div>
    </div>
  );
}

//  Main Screen

export default function ProfileScreen({ onBack, onMatchHistory }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [analytics, setAnalytics] = useState<UserAnalytics | null>(null);
  const [ratingHistory, setRatingHistory] = useState<RatingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { session } = await connect();
        const uid = session.user_id ?? null;
        if (alive) setMyUserId(uid);

        const [p, a] = await Promise.all([
          getProfile(session),
          getAnalytics(session),
        ]);
        if (!alive) return;
        setProfile(p);
        setAnalytics(a);

        // Rating history is non-critical — load after primary data
        if (uid) {
          getRatingHistory(session, uid, 50)
            .then((pts) => {
              if (alive) setRatingHistory(pts);
            })
            .catch(() => {}); // non-fatal
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const wins = profile?.wins ?? 0;
  const losses = profile?.losses ?? 0;
  const draws = profile?.draws ?? 0;
  const rating = profile?.rating ?? 800;
  const streak = profile?.winStreak ?? 0;
  const best = profile?.bestStreak ?? 0;
  const gamesPlayed = profile?.gamesPlayed ?? 0;
  const total = wins + losses + draws;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  const isProvisional = gamesPlayed < 10;

  const blank: [number, number, number][] = Array(9).fill([0, 0, 0]);
  const openingStats = analytics?.openingStats ?? blank;
  const cellHeatmap = analytics?.cellHeatmap ?? blank;
  const { bestCell, bestWinRate, worstCell, worstWinRate } =
    bestOpening(openingStats);

  return (
    <div
      className="screen"
      role="main"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "auto",
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
          Profile
        </span>
      </header>

      <div
        style={{
          padding: "20px var(--pad) 40px",
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {/* Identity */}
        <section>
          <span className="t-label" style={{ color: "var(--muted)" }}>
            Operator
          </span>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 28,
              fontWeight: 900,
              letterSpacing: -1,
              color: "var(--soft)",
              marginTop: 6,
              lineHeight: 1,
            }}
          >
            {loading ? (
              <span className="blink" style={{ color: "var(--muted)" }}>
                ▪▪▪
              </span>
            ) : (
              (profile?.username ?? "Guest")
            )}
          </div>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span className="t-label">Rating</span>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 14,
                fontWeight: 900,
                color: "var(--coral)",
                letterSpacing: 1,
              }}
            >
              {loading ? "—" : rating}
            </span>
            {isProvisional && !loading && (
              <span
                className="pill"
                style={{
                  borderColor: "rgba(240,160,80,0.4)",
                  color: "var(--amber)",
                  fontSize: 8,
                  letterSpacing: 1.5,
                }}
              >
                Provisional
              </span>
            )}
            {streak > 1 && (
              <span
                className="pill pill-coral"
                style={{ fontSize: 8, letterSpacing: 1.5 }}
              >
                🔥 {streak} streak
              </span>
            )}
          </div>
        </section>

        {/* Win rate */}
        <section>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <span className="t-label">Win rate</span>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1,
                color: "var(--coral)",
              }}
            >
              {loading ? "—" : `${winRate}%`}
            </span>
          </div>
          <div className="prog-bar">
            <div
              className="prog-fill"
              style={{
                width: loading ? "0%" : `${winRate}%`,
                transition: "width 0.6s steps(10)",
              }}
            />
          </div>
        </section>

        {/* ── Rating progression graph ── */}
        <section>
          <span
            className="t-label"
            style={{
              display: "block",
              marginBottom: 14,
              color: "var(--muted)",
            }}
          >
            ▸ Rating progression
          </span>

          {/* Graph container — matches existing surface style */}
          <div
            style={{
              background: "var(--surface-lo)",
              border: "1px solid var(--rim)",
              padding: "16px 14px 12px",
              overflow: "hidden",
            }}
          >
            {loading ? (
              <div
                style={{
                  height: 180,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  className="blink"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    color: "var(--muted)",
                  }}
                >
                  Loading…
                </span>
              </div>
            ) : (
              <RatingGraph
                points={ratingHistory}
                currentRating={rating}
                startRating={800}
                provisionalGames={10}
              />
            )}
          </div>

          {/* Provisional explanation — only shown during first 10 games */}
          {isProvisional && !loading && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 12px",
                background: "rgba(240,160,80,0.06)",
                border: "1px solid rgba(240,160,80,0.18)",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  color: "var(--amber)",
                  flexShrink: 0,
                  paddingTop: 1,
                }}
              >
                ▸ Provisional
              </span>
              <span className="t-label" style={{ color: "var(--muted)" }}>
                First {10 - gamesPlayed} game{10 - gamesPlayed !== 1 ? "s" : ""}{" "}
                until your rating stabilises. Wins earn +30, losses cost −15
                during placement.
              </span>
            </div>
          )}
        </section>

        {/* Match record */}
        <section>
          <span
            className="t-label"
            style={{
              display: "block",
              marginBottom: 14,
              color: "var(--muted)",
            }}
          >
            ▸ Match record
          </span>
          <div className="stat-grid-3">
            <StatCell
              value={loading ? "—" : wins}
              label="Wins"
              color="var(--coral)"
            />
            <div className="stat-div" />
            <StatCell
              value={loading ? "—" : losses}
              label="Losses"
              color="var(--amber)"
            />
            <div className="stat-div" />
            <StatCell value={loading ? "—" : draws} label="Draws" />
          </div>
          <div
            className="stat-grid"
            style={{ marginTop: 3, borderTop: "none" }}
          >
            <StatCell
              value={loading ? "—" : streak}
              label="Current streak"
              color="var(--coral)"
            />
            <div className="stat-div" />
            <StatCell value={loading ? "—" : best} label="Best streak" />
          </div>
        </section>

        {/* Game analytics */}
        {analytics && (
          <section>
            <span
              className="t-label"
              style={{
                display: "block",
                marginBottom: 14,
                color: "var(--muted)",
              }}
            >
              ▸ Game analytics
            </span>
            <div className="stat-grid-3">
              <StatCell value={analytics.gamesPlayed} label="Games played" />
              <div className="stat-div" />
              <StatCell value={analytics.avgMovesPerGame} label="Avg moves" />
              <div className="stat-div" />
              <StatCell value={analytics.totalMoves} label="Total moves" />
            </div>
            <div
              className="stat-grid"
              style={{ marginTop: 3, borderTop: "none" }}
            >
              <StatCell
                value={analytics.timeoutLosses}
                label="Timeout losses"
                color="var(--amber)"
              />
              <div className="stat-div" />
              <StatCell
                value={analytics.forfeitLosses}
                label="Forfeit losses"
                color="var(--amber)"
              />
            </div>
          </section>
        )}

        {/* Opening insights */}
        {analytics && (bestCell !== null || worstCell !== null) && (
          <section>
            <span
              className="t-label"
              style={{
                display: "block",
                marginBottom: 14,
                color: "var(--muted)",
              }}
            >
              ▸ Opening insights
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {bestCell !== null && (
                <InsightCard
                  label="Best opening"
                  cellLabel={CELL_LABELS[bestCell]}
                  winRate={bestWinRate}
                  variant="coral"
                />
              )}
              {worstCell !== null && worstCell !== bestCell && (
                <InsightCard
                  label="Weakest opening"
                  cellLabel={CELL_LABELS[worstCell]}
                  winRate={worstWinRate}
                  variant="amber"
                />
              )}
            </div>
          </section>
        )}

        {/* Thermal heatmap */}
        <section>
          <span
            className="t-label"
            style={{
              display: "block",
              marginBottom: 14,
              color: "var(--muted)",
            }}
          >
            ▸ Board heatmap
          </span>
          <ThermalHeatmap
            openingData={openingStats}
            activityData={cellHeatmap}
          />
        </section>

        {/* Match history */}
        <section>
          <button
            className="btn btn-ghost btn-full"
            onClick={onMatchHistory}
            type="button"
            style={{
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 2.5,
                  textTransform: "uppercase",
                  display: "block",
                  color: "var(--muted)",
                  marginBottom: 2,
                }}
              >
                History
              </span>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 15,
                  fontWeight: 800,
                  color: "var(--soft)",
                }}
              >
                Match History
              </span>
            </span>
            <span style={{ color: "var(--muted)", fontSize: 18 }}>→</span>
          </button>
        </section>
      </div>
    </div>
  );
}
