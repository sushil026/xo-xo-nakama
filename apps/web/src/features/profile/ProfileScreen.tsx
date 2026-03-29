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

  // Replace the entire draw callback inside ThermalHeatmap

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

    //  Background
    hCtx.fillStyle = "#111110";
    hCtx.fillRect(0, 0, W, W);

    const totals = data.map(([w, l, d]) => w + l + d);
    const maxTotal = Math.max(...totals, 1);

    //  Compute intensity per cell
    const intensities = data.map((_, i) => totals[i] / maxTotal);

    // Color key per cell
    const colorKeys = data.map(
      ([w, l, d]): "hot" | "amber" | "green" | "empty" => {
        const total = w + l + d;
        if (total === 0) return "empty";
        if (!isOpening) return "hot"; // activity mode: always thermal red
        const wr = w / total;
        const lr = l / total;
        if (wr >= lr && wr >= d / total) return "hot"; // win-heavy → red/orange
        if (lr > wr && lr >= d / total) return "green"; // loss-heavy → green
        return "amber"; // draw-heavy → amber
      },
    );

    hCtx.fillStyle = "#0e0e0c";
    hCtx.fillRect(0, 0, W, W);

    // Stable per-render jitter
    const rng = (() => {
      let s = 0xdeadbeef;
      return () => {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        return (s >>> 0) / 0xffffffff;
      };
    })();

    const THERMAL: Record<string, (a: number) => CanvasGradient> = {
      hot: (alpha) => {
        // white core → yellow → orange → red → dark
        const g = hCtx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(255,255,220,${alpha})`);
        g.addColorStop(0.12, `rgba(255,220,0,${alpha * 0.95})`);
        g.addColorStop(0.3, `rgba(255,110,0,${alpha * 0.85})`);
        g.addColorStop(0.55, `rgba(210,20,0,${alpha * 0.6})`);
        g.addColorStop(0.78, `rgba(100,0,40,${alpha * 0.25})`);
        g.addColorStop(1, `rgba(0,0,0,0)`);
        return g;
      },
      green: (alpha) => {
        const g = hCtx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(200,255,150,${alpha})`);
        g.addColorStop(0.2, `rgba(80,220,40,${alpha * 0.9})`);
        g.addColorStop(0.45, `rgba(20,160,20,${alpha * 0.65})`);
        g.addColorStop(0.72, `rgba(0,80,10,${alpha * 0.25})`);
        g.addColorStop(1, `rgba(0,0,0,0)`);
        return g;
      },
      amber: (alpha) => {
        const g = hCtx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(255,240,160,${alpha})`);
        g.addColorStop(0.25, `rgba(240,160,40,${alpha * 0.9})`);
        g.addColorStop(0.5, `rgba(180,90,0,${alpha * 0.6})`);
        g.addColorStop(0.78, `rgba(80,30,0,${alpha * 0.2})`);
        g.addColorStop(1, `rgba(0,0,0,0)`);
        return g;
      },
    };

    const drawBlob = (
      cx: number,
      cy: number,
      radius: number,
      alpha: number,
      colorKey: string,
    ) => {
      hCtx.save();
      hCtx.translate(cx, cy);
      hCtx.scale(radius, radius);
      const grad = THERMAL[colorKey]?.(alpha) ?? THERMAL.hot(alpha);
      // Re-create gradient in local space
      hCtx.restore();

      // Draw in world space with proper gradient
      const g2 = hCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      const stops: [number, string][] =
        colorKey === "hot"
          ? [
              [0, `rgba(255,255,220,${alpha})`],
              [0.12, `rgba(255,220,0,${alpha * 0.95})`],
              [0.3, `rgba(255,110,0,${alpha * 0.85})`],
              [0.55, `rgba(210,20,0,${alpha * 0.6})`],
              [0.78, `rgba(100,0,40,${alpha * 0.25})`],
              [1, `rgba(0,0,0,0)`],
            ]
          : colorKey === "green"
            ? [
                [0, `rgba(200,255,150,${alpha})`],
                [0.2, `rgba(80,220,40,${alpha * 0.9})`],
                [0.45, `rgba(20,160,20,${alpha * 0.65})`],
                [0.72, `rgba(0,80,10,${alpha * 0.25})`],
                [1, `rgba(0,0,0,0)`],
              ]
            : [
                [0, `rgba(255,240,160,${alpha})`],
                [0.25, `rgba(240,160,40,${alpha * 0.9})`],
                [0.5, `rgba(180,90,0,${alpha * 0.6})`],
                [0.78, `rgba(80,30,0,${alpha * 0.2})`],
                [1, `rgba(0,0,0,0)`],
              ];
      stops.forEach(([t, c]) => g2.addColorStop(t, c));
      hCtx.fillStyle = g2;
      hCtx.beginPath();
      hCtx.ellipse(cx, cy, radius * 1.08, radius * 0.94, 0, 0, Math.PI * 2);
      hCtx.fill();
    };

    intensities.forEach((intensity, i) => {
      const colorKey = colorKeys[i];
      if (colorKey === "empty") return;

      const col = i % 3;
      const row = Math.floor(i / 3);
      const cx = col * CELL + CELL / 2;
      const cy = row * CELL + CELL / 2;

      // Minimum intensity 0.4 so even single-play cells are visible
      const eff = Math.max(intensity, 0.4);
      const baseRadius = CELL * (0.38 + eff * 0.3);
      const baseAlpha = 0.5 + eff * 0.45;

      hCtx.save();
      hCtx.beginPath();
      hCtx.rect(col * CELL, row * CELL, CELL, CELL);
      hCtx.clip();

      drawBlob(cx, cy, baseRadius, baseAlpha, colorKey);

      // 2 satellite blobs
      for (let s = 0; s < 2; s++) {
        const angle = rng() * Math.PI * 2;
        const dist = rng() * CELL * 0.18;
        drawBlob(
          cx + Math.cos(angle) * dist,
          cy + Math.sin(angle) * dist,
          baseRadius * (0.3 + rng() * 0.25),
          baseAlpha * (0.25 + rng() * 0.3),
          colorKey,
        );
      }
      hCtx.restore();
    });

    // Grid lines
    hCtx.strokeStyle = "rgba(255,255,255,0.07)";
    hCtx.lineWidth = 1;
    for (let n = 0; n <= 3; n++) {
      hCtx.beginPath();
      hCtx.moveTo(n * CELL, 0);
      hCtx.lineTo(n * CELL, W);
      hCtx.stroke();
      hCtx.beginPath();
      hCtx.moveTo(0, n * CELL);
      hCtx.lineTo(W, n * CELL);
      hCtx.stroke();
    }

    //  Labels — center aligned
    lCtx.clearRect(0, 0, W, W);
    data.forEach(([w, l, d], i) => {
      const total = w + l + d;
      const col = i % 3;
      const row = Math.floor(i / 3);
      const cx = col * CELL + CELL / 2;
      const cy = row * CELL + CELL / 2;

      // Cell label top-left
      lCtx.font = "600 9px system-ui,sans-serif";
      lCtx.fillStyle = "rgba(255,255,255,0.3)";
      lCtx.textAlign = "left";
      lCtx.textBaseline = "top";
      lCtx.fillText(CELL_LABELS[i], col * CELL + 6, row * CELL + 5);

      lCtx.textBaseline = "middle";

      if (total > 0) {
        lCtx.shadowColor = "rgba(0,0,0,0.9)";
        lCtx.shadowBlur = 8;

        // Primary number/% — perfectly centered
        const primary = isOpening
          ? `${Math.round((w / total) * 100)}%`
          : String(total);

        lCtx.font = `900 ${isOpening ? 20 : 22}px system-ui,sans-serif`;
        lCtx.fillStyle = "rgba(255,255,255,0.95)";
        lCtx.textAlign = "center";
        lCtx.fillText(primary, cx, cy - 6);

        // W/L/D sub-label
        lCtx.font = "400 8.5px system-ui,sans-serif";
        lCtx.fillStyle = "rgba(255,255,255,0.5)";
        lCtx.fillText(`${w}W ${l}L ${d}D`, cx, cy + 11);

        lCtx.shadowBlur = 0;
      } else {
        lCtx.font = "400 16px system-ui,sans-serif";
        lCtx.fillStyle = "rgba(255,255,255,0.1)";
        lCtx.textAlign = "center";
        lCtx.fillText("—", cx, cy);
      }
    });

    // Scale bar
    const sg = sCtx.createLinearGradient(0, 0, scaleCanvas.width, 0);
    if (isOpening) {
      sg.addColorStop(0, "rgba(20,160,20,0.9)"); // loss = green left
      sg.addColorStop(0.4, "rgba(240,160,40,0.85)"); // draw = amber mid
      sg.addColorStop(0.7, "rgba(255,100,0,0.9)"); // win = orange
      sg.addColorStop(1, "rgba(255,230,150,1)"); // hot win = yellow-white
    } else {
      sg.addColorStop(0, "rgba(0,60,0,0.5)");
      sg.addColorStop(0.3, "rgba(60,180,20,0.75)");
      sg.addColorStop(0.6, "rgba(255,160,0,0.88)");
      sg.addColorStop(0.85, "rgba(255,60,0,0.95)");
      sg.addColorStop(1, "rgba(255,240,180,1)");
    }
    sCtx.clearRect(0, 0, scaleCanvas.width, scaleCanvas.height);
    sCtx.fillStyle = sg;
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
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
        }}
      >
        {/* Row axis — LEFT (takes width) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 36,
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

        {/* RIGHT spacer — mirrors left axis exactly */}
        <div style={{ width: 36, flexShrink: 0 }} />
      </div>

      {/* Scale bar — same total width as grid block, no marginLeft offset */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 10,
          width: SIZE + 36 + 36, // canvas + left label width + right spacer
          marginLeft: "auto",
          marginRight: "auto",
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

      {/* Legend */}
      <div
        style={{
          marginTop: 10,
          width: SIZE + 36 + 36,
          marginLeft: "auto",
          marginRight: "auto",
          height: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
        }}
      >
        {isOpening ? (
          (["coral", "amber", "muted"] as const).map((key) => {
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
          })
        ) : (
          <span style={{ visibility: "hidden" }} className="t-label">
            placeholder
          </span>
        )}
      </div>
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
  const isProvisional = gamesPlayed < 3;

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
          gap: 20,
        }}
      >
        {/* Identity + Win rate */}
        <section>
          {/* Username */}
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

          {/* Rating row */}
          <div
            style={{
              marginTop: 8,
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

          {/* Win rate bar — merged in */}
          <div style={{ marginTop: 14 }}>
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
          </div>
        </section>

        {/*  Rating progression graph  */}
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
          <div
            style={{
              background: "var(--surface-lo)",
              border: "1px solid var(--rim)",
              padding: "16px 14px 12px",
              overflow: "hidden",
              display: "flex",
              justifyContent: "center",
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
                provisionalGames={3}
              />
            )}
          </div>
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
                First {3 - gamesPlayed} game{3 - gamesPlayed !== 1 ? "s" : ""}{" "}
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

        {/*  6. GAME ANALYTICS  */}
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

        {/*  7. ACTIONS  */}
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ActionButton
            label="History"
            title="Match History"
            onClick={onMatchHistory}
          />
        </section>
      </div>
    </div>
  );
}

//  Action Button component
function ActionButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-full"
      onClick={onClick}
      type="button"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px",
        transition: "box-shadow 150ms ease, border-color 150ms ease",
        boxShadow: hovered
          ? "0 0 0 1px rgba(255,85,64,0.35), 0 0 12px rgba(255,85,64,0.08)"
          : "none",
        borderColor: hovered ? "rgba(255,85,64,0.4)" : undefined,
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
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 15,
            fontWeight: 800,
            color: "var(--soft)",
          }}
        >
          {title}
        </span>
      </span>
      <span
        style={{
          color: hovered ? "var(--coral)" : "var(--muted)",
          fontSize: 18,
          transition: "color 150ms ease",
        }}
      >
        →
      </span>
    </button>
  );
}
