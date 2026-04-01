import { useEffect, useRef, useState, useCallback } from "react";

//  Types

export interface RatingPoint {
  game: number; // sequential game number (1-based)
  rating: number;
  outcome: "win" | "loss" | "draw";
}

interface Props {
  points: RatingPoint[];
  currentRating: number;
  startRating?: number;
  provisionalGames?: number; // how many games count as "early" (default 10)
}

//  Constants

const PROVISIONAL_GAMES = 10;
const TIER_LINES = [
  { rating: 1200, label: "ELITE" },
  { rating: 1000, label: "PRO" },
  { rating: 800, label: "BASE" },
  { rating: 600, label: "GRIND" },
] as const;

const OUTCOME_COLOR = {
  win: "#ff5540",
  loss: "#f0a050",
  draw: "#8c8c82",
} as const;

//  Helpers

function getTierLabel(rating: number): { label: string; color: string } {
  if (rating >= 1200) return { label: "ELITE", color: "#ff5540" };
  if (rating >= 1000) return { label: "PRO", color: "#ff7a40" };
  if (rating >= 800) return { label: "BASE", color: "#f0a050" };
  if (rating >= 600) return { label: "GRIND", color: "#a0a090" };
  return { label: "ROOKIE", color: "#6a6a60" };
}

//  Component

export default function RatingGraph({
  points,
  currentRating,
  startRating = 800,
  provisionalGames = PROVISIONAL_GAMES,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<RatingPoint | null>(null);
  const [hovX, setHovX] = useState(0);
  const [hovY, setHovY] = useState(0);
  const [animProg, setAnimProg] = useState(0);
  const animRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const ANIM_MS = 900;

  // Canvas layout (logical px — we scale by devicePixelRatio)
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  const H = 180;
  const PAD = { top: 16, right: 20, bottom: 28, left: 42 };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      if (width > 0) setW(Math.floor(width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  }, [W]); // add W as dependency

  //  Data prep
  const allRatings = [
    startRating,
    ...points.map((p) => p.rating),
    currentRating,
  ];
  const minR = Math.max(0, Math.min(...allRatings) - 60);
  const maxR = Math.max(...allRatings) + 60;

  // Build full series starting from (0, startRating)
  const series: {
    game: number;
    rating: number;
    outcome?: RatingPoint["outcome"];
  }[] = [{ game: 0, rating: startRating }];
  const visiblePoints = compressPoints(points);

  visiblePoints.forEach((p) =>
    series.push({ game: p.game, rating: p.rating, outcome: p.outcome }),
  );

  // totalGames: if only 1 game played, still spread across full width
  const totalGames = Math.max(series[series.length - 1]?.game ?? 0, 1);

  const toX = useCallback(
    (game: number) => {
      // With a single real point (totalGames=1), map game 0 -> PAD.left, game 1 -> W-PAD.right
      const span = Math.max(totalGames, 1);
      return PAD.left + (game / span) * (W - PAD.left - PAD.right);
    },
    [totalGames, W, PAD.left, PAD.right],
  );

  const toY = useCallback(
    (rating: number) =>
      PAD.top +
      (1 - (rating - minR) / (maxR - minR)) * (H - PAD.top - PAD.bottom),
    [minR, maxR, H, PAD.top, PAD.bottom],
  );

  //  Draw
  const draw = useCallback(
    (prog: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const bgColor = "#161614";
      const gridColor = "rgba(255,255,255,0.05)";
      const axisColor = "rgba(255,255,255,0.18)";
      const textColor = "rgba(255,255,255,0.35)";
      const lineColor = "#ff5540";

      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, W, H);

      // Tier guide lines
      TIER_LINES.forEach(({ rating, label }) => {
        if (rating < minR || rating > maxR) return;
        const y = toY(rating);
        ctx.save();
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = textColor;
        ctx.font = "600 8px system-ui,sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(label, PAD.left - 4, y + 3);
      });

      // Y-axis rating labels
      const rStep = Math.ceil((maxR - minR) / 4 / 100) * 100;
      for (let r = Math.ceil(minR / rStep) * rStep; r <= maxR; r += rStep) {
        const y = toY(r);
        if (y < PAD.top || y > H - PAD.bottom) continue;
        ctx.fillStyle = textColor;
        ctx.font = "500 8px system-ui,sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(String(r), PAD.left - 4, y + 3);
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.stroke();
      }

      //  No data yet: draw a flat dashed baseline at startRating
      if (series.length < 2) {
        const y = toY(startRating);
        ctx.save();
        ctx.strokeStyle = "rgba(255,85,64,0.25)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.stroke();
        ctx.restore();

        // Start dot
        ctx.beginPath();
        ctx.arc(PAD.left, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,85,64,0.5)";
        ctx.fill();

        // X axis
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD.left, H - PAD.bottom);
        ctx.lineTo(W - PAD.right, H - PAD.bottom);
        ctx.stroke();
        return;
      }

      // Clamp series to animation progress
      const visibleCount = Math.max(2, Math.round(prog * series.length));
      const visible = series.slice(0, visibleCount);

      // Provisional zone shading (first N games)
      if (provisionalGames > 0) {
        const provX = toX(Math.min(provisionalGames, totalGames));
        ctx.fillStyle = "rgba(255,85,64,0.04)";
        ctx.fillRect(
          PAD.left,
          PAD.top,
          provX - PAD.left,
          H - PAD.top - PAD.bottom,
        );
        if (prog > 0.1 && provX < W - PAD.right) {
          ctx.fillStyle = "rgba(255,85,64,0.3)";
          ctx.font = "700 7px system-ui,sans-serif";
          ctx.textAlign = "left";
          ctx.fillText("PROVISIONAL", PAD.left + 3, PAD.top + 9);
        }
      }

      // Gradient fill under line
      const gradFill = ctx.createLinearGradient(0, PAD.top, 0, H - PAD.bottom);
      gradFill.addColorStop(0, "rgba(255,85,64,0.22)");
      gradFill.addColorStop(0.5, "rgba(255,85,64,0.08)");
      gradFill.addColorStop(1, "rgba(255,85,64,0)");

      ctx.beginPath();
      visible.forEach(({ game, rating }, i) => {
        const x = toX(game);
        const y = toY(rating);
        if (i === 0) ctx.moveTo(x, y);
        else {
          const prev = visible[i - 1];
          const px = toX(prev.game);
          const py = toY(prev.rating);
          const cp = (x - px) * 0.45;
          ctx.bezierCurveTo(px + cp, py, x - cp, y, x, y);
        }
      });
      const lastX = toX(visible[visible.length - 1].game);
      ctx.lineTo(lastX, H - PAD.bottom);
      ctx.lineTo(PAD.left, H - PAD.bottom);
      ctx.closePath();
      ctx.fillStyle = gradFill;
      ctx.fill();

      // Main line
      // const FADE_START_INDEX = Math.max(0, visible.length - 20);

      for (let i = 1; i < visible.length; i++) {
        const curr = visible[i];
        const prev = visible[i - 1];

        const x = toX(curr.game);
        const y = toY(curr.rating);
        const px = toX(prev.game);
        const py = toY(prev.rating);

        const cp = (x - px) * 0.45;

        // Fade logic
        const distanceFromRecent = visible.length - i;
        const alpha =
          distanceFromRecent <= 20
            ? 1
            : Math.max(0.2, 1 - (distanceFromRecent - 20) * 0.05);

        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";

        ctx.moveTo(px, py);
        ctx.bezierCurveTo(px + cp, py, x - cp, y, x, y);

        ctx.stroke();
      }

      // reset alpha
      ctx.globalAlpha = 1;

      const trendPoints = visible.slice(-10);

      if (trendPoints.length >= 2) {
        const first = trendPoints[0];
        const last = trendPoints[trendPoints.length - 1];

        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 1;

        ctx.moveTo(toX(first.game), toY(first.rating));
        ctx.lineTo(toX(last.game), toY(last.rating));

        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Outcome dots (skip index 0 = origin)
      visible.slice(1).forEach(({ game, rating, outcome }, i) => {
        const isRecent = i > visible.length - 20;

        if (!isRecent && visible.length > 40) return;
        if (!outcome) return;
        const x = toX(game);
        const y = toY(rating);
        const col = OUTCOME_COLOR[outcome];
        const dotR = outcome === "win" ? 4 : 3;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.strokeStyle = "#161614";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Live cursor dot at tip
      if (prog >= 0.99 && visible.length >= 2) {
        if (visible.length >= 2) {
          const last = visible[visible.length - 1];
          const lx = toX(last.game);
          const ly = toY(last.rating);

          ctx.fillStyle = "#ff5540";
          ctx.font = "700 10px system-ui,sans-serif";
          ctx.textAlign = "left";

          ctx.fillText(
            String(last.rating),
            Math.min(lx + 8, W - PAD.right - 30),
            ly + 3,
          );
        }

        const last = visible[visible.length - 1];
        const x = toX(last.game);
        const y = toY(last.rating);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,85,64,0.3)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Hover crosshair
      if (hovered && prog >= 0.99) {
        const x = toX(hovered.game);
        const y = toY(hovered.rating);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x, PAD.top);
        ctx.lineTo(x, H - PAD.bottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = OUTCOME_COLOR[hovered.outcome];
        ctx.fill();
        ctx.strokeStyle = "#161614";
        ctx.stroke();
      }

      // X-axis
      ctx.strokeStyle = axisColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, H - PAD.bottom);
      ctx.lineTo(W - PAD.right, H - PAD.bottom);
      ctx.stroke();

      // X tick labels (every N games)
      const xStep = totalGames <= 10 ? 1 : totalGames <= 30 ? 5 : 10;
      for (let g = 1; g <= totalGames; g += xStep) {
        const x = toX(g);
        ctx.fillStyle = textColor;
        ctx.font = "500 8px system-ui,sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(g), x, H - PAD.bottom + 11);
      }
    },
    [series, hovered, minR, maxR, totalGames, provisionalGames, toX, toY],
  );

  //  Animation loop
  useEffect(() => {
    startRef.current = null;
    setAnimProg(0);
    animRef.current = requestAnimationFrame(function tick(ts) {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const p = Math.min(elapsed / ANIM_MS, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setAnimProg(eased);
      if (p < 1) animRef.current = requestAnimationFrame(tick);
    });
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [points]);

  //  Draw on every prog/hovered change
  useEffect(() => {
    draw(animProg);
  }, [draw, animProg]);

  //  DPR-aware canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  }, []);

  //  Hit-test on mouse/touch
  const handlePointer = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (animProg < 0.99 || series.length < 2) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const scaleX = W / rect.width;
      const mx = (e.clientX - rect.left) * scaleX;
      let closest: RatingPoint | null = null;
      let closestDist = Infinity;
      points.forEach((p) => {
        const x = toX(p.game);
        const d = Math.abs(mx - x);
        if (d < closestDist) {
          closestDist = d;
          closest = p;
        }
      });
      if (closest && closestDist < 30) {
        const cp = closest as RatingPoint;
        setHovered(cp);
        setHovX(toX(cp.game));
        setHovY(toY(cp.rating));
      } else {
        setHovered(null);
      }
    },
    [animProg, points, series.length, toX, toY],
  );

  const tier = getTierLabel(currentRating);

  function compressPoints(points: RatingPoint[]) {
    const MAX_POINTS = 32;
    const RECENT_COUNT = 20;

    if (points.length <= MAX_POINTS) return points;

    const recent = points.slice(-RECENT_COUNT);
    const older = points.slice(0, -RECENT_COUNT);

    const bucketSize = Math.ceil(older.length / (MAX_POINTS - RECENT_COUNT));

    const buckets: RatingPoint[] = [];

    for (let i = 0; i < older.length; i += bucketSize) {
      const chunk = older.slice(i, i + bucketSize);

      const avg = chunk.reduce((s, p) => s + p.rating, 0) / chunk.length;

      buckets.push({
        game: chunk[chunk.length - 1].game,
        rating: avg,
        outcome: chunk[chunk.length - 1].outcome,
      });
    }

    return [...buckets, ...recent];
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 28,
              fontWeight: 900,
              letterSpacing: -1,
              color: "var(--coral)",
              lineHeight: 1,
            }}
          >
            {currentRating}
          </span>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2.5,
              color: tier.color,
            }}
          >
            {tier.label}
          </span>
        </div>

        {/* Delta chip */}
        {points.length > 0 &&
          (() => {
            const delta = currentRating - startRating;
            const sign = delta >= 0 ? "+" : "";
            return (
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.5,
                  color: delta >= 0 ? "var(--coral)" : "var(--amber)",
                  padding: "3px 8px",
                  border: `1px solid ${delta >= 0 ? "rgba(255,85,64,0.35)" : "rgba(240,160,80,0.35)"}`,
                  background:
                    delta >= 0
                      ? "rgba(255,85,64,0.08)"
                      : "rgba(240,160,80,0.08)",
                }}
              >
                {sign}
                {delta} all-time
              </span>
            );
          })()}
      </div>

      {/* Canvas */}
      <div style={{ position: "relative", overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          onMouseMove={handlePointer}
          onMouseLeave={() => setHovered(null)}
          style={{ display: "block", cursor: "crosshair", borderRadius: 3 }}
        />

        {/* Tooltip */}
        {hovered && (
          <div
            style={{
              position: "absolute",
              left: Math.min(hovX + 10, W - 110),
              top: Math.max(hovY - 52, 4),
              background: "var(--surface-lo)",
              border: `1px solid ${OUTCOME_COLOR[hovered.outcome]}55`,
              padding: "6px 10px",
              pointerEvents: "none",
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              minWidth: 90,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: OUTCOME_COLOR[hovered.outcome],
                marginBottom: 4,
              }}
            >
              {hovered.outcome} · game {hovered.game}
            </div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 900,
                letterSpacing: -0.5,
                color: "var(--soft)",
                lineHeight: 1,
              }}
            >
              {hovered.rating}
            </div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 9,
                color: "var(--muted)",
                marginTop: 2,
              }}
            >
              {hovered.rating > startRating
                ? `+${hovered.rating - startRating} from start`
                : `${hovered.rating - startRating} from start`}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
        {(["win", "loss", "draw"] as const).map((o) => (
          <div
            key={o}
            style={{ display: "flex", alignItems: "center", gap: 5 }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: OUTCOME_COLOR[o],
                flexShrink: 0,
              }}
            />
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
              {o}
            </span>
          </div>
        ))}
        {provisionalGames > 0 && points.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginLeft: "auto",
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                background: "rgba(255,85,64,0.25)",
                border: "1px solid rgba(255,85,64,0.4)",
                flexShrink: 0,
              }}
            />
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
              Provisional
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
