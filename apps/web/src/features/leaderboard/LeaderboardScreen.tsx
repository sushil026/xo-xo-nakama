import { useEffect, useState } from "react";
import {
  connect,
  getLeaderboard,
  getMyLeaderboardRecord,
  getProfile,
} from "../../services/nakamaClient";

import type { LeaderboardEntry } from "../../services/nakamaClient";

interface Props {
  onBack: () => void;
}

type Tab = "xo_alltime" | "xo_monthly";

// Design tokens

const RANK_CFG = [
  { color: "#e8d48b", bg: "rgba(232, 212, 139, 0.12)" }, // 1 gold
  { color: "#c8c8be", bg: "rgba(200,200,190,0.06)" }, // 2 silver
  { color: "#ff5540", bg: "rgba(255,85,64,0.08)" }, // 3 coral
  { color: "#7eb8c9", bg: "rgba(126,184,201,0.06)" }, // 4 teal
  { color: "#a78fd0", bg: "rgba(167,143,208,0.06)" }, // 5 purple
];
const ME_COLOR = "#f0a050";

function winRate(e: LeaderboardEntry) {
  const t = e.wins + e.losses + e.draws;
  return t === 0 ? "—" : Math.round((e.wins / t) * 100) + "%";
}

// SVG assets (user-provided)

function TrophySvg({ color, size = 28 }: { color: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        fill={color}
        d="M11.7 8c4.2-.3 4.3-2.7 4.3-5h-3V0H3v3H0c0 2.3.1 4.7 4.3 5 .9 1.4 2.1 2 2.7 2v4c-3 0-3 2-3 2h8s0-2-3-2v-4c.6 0 1.8-.6 2.7-2M13 4h2c-.1 1.6-.4 2.7-2.7 2.9.3-.8.6-1.7.7-2.9M1 4h2c.1 1.2.4 2.1.7 2.9C1.5 6.7 1.1 5.6 1 4m3.5 2.1C4 4.4 4 3 4 3V1h1v2s0 1.7.4 3.1C5.9 7.8 7 9 7 9s-1.8-.2-2.5-2.9"
      />
    </svg>
  );
}

function PodiumSvg({ color, size = 56 }: { color: string; size?: number }) {
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {/* Trailing light orbiting the podium */}
      <svg
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          overflow: "visible",
        }}
        width={size * 1.43}
        height={size * 1.43}
        viewBox="0 0 80 80"
      >
        <defs>
          <linearGradient id="podium-trail1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(240,160,80,0)" />
            <stop offset="60%" stopColor="rgba(240,160,80,0.9)" />
            <stop offset="100%" stopColor="rgba(255,200,100,1)" />
          </linearGradient>
        </defs>
        <ellipse
          cx="40"
          cy="42"
          rx="32"
          ry="20"
          fill="none"
          stroke="url(#podium-trail1)"
          strokeWidth="1.5"
          strokeDasharray="30 290"
          style={{
            animation: "podium-trail-move 2.8s linear infinite",
            transformOrigin: "40px 42px",
          }}
        />
        <ellipse
          cx="40"
          cy="42"
          rx="32"
          ry="20"
          fill="none"
          stroke="rgba(255,200,80,0.3)"
          strokeWidth="2.5"
          strokeDasharray="15 305"
          style={{
            animation: "podium-trail-move2 2.8s linear infinite",
            transformOrigin: "40px 42px",
          }}
        />
      </svg>

      {/* The actual podium icon */}
      <svg
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 301.037 301.037"
        style={{ display: "block", position: "relative", zIndex: 1 }}
      >
        <path
          fill={color}
          d="M222.519 226.469h9.75v32.63h-9.75zm21.84 0h9.75v32.63h-9.75zm21.06 0h9.75v32.63h-9.75zm-229.322 0h9.75v32.63h-9.75zm21.842 0h9.75v32.63h-9.75z"
        />
        <path
          fill={color}
          d="m110.067 56.691 19.825 14.3-7.085 23.595c-.585 1.95.13 4.095 1.82 5.33a4.88 4.88 0 0 0 5.655.065l20.67-14.365 20.67 14.365c.845.585 1.82.845 2.795.845 1.04 0 2.08-.325 2.99-.91 1.69-1.3 2.34-3.445 1.69-5.46l-7.8-23.53 19.76-14.235c1.69-1.235 2.405-3.38 1.82-5.395a4.94 4.94 0 0 0-4.55-3.445l-24.96-.715-7.8-22.88c-.65-1.95-2.47-3.315-4.55-3.315-2.015 0-3.9 1.235-4.615 3.185l-8.58 23.01-25.025.715c-2.145.065-3.965 1.43-4.55 3.445s.13 4.16 1.82 5.395m31.33.13a4.91 4.91 0 0 0 4.42-3.185l4.94-13.26 4.485 13.13c.65 1.95 2.47 3.25 4.485 3.315l13.91.39-10.985 7.93c-1.69 1.235-2.405 3.445-1.755 5.46l4.29 13.065-11.44-7.995a4.89 4.89 0 0 0-5.59 0l-11.96 8.32 4.095-13.52c.585-1.95-.13-4.095-1.82-5.33l-10.985-7.93zm159.575 152.555c0-.065 0-.13-.065-.195 0-.065 0-.13-.065-.13-.065-.26-.13-.52-.26-.715v-.065l-.195-.39c-.065-.065-.065-.13-.13-.195s-.065-.13-.13-.195-.065-.13-.13-.13a.9.9 0 0 1-.195-.26l-.13-.13a.9.9 0 0 1-.195-.26l-21.84-21.19c-.91-.91-2.145-1.365-3.38-1.365h-70.33v-39.78c0-.065 0-.195-.065-.26 0-.065 0-.13-.065-.195 0-.065 0-.13-.065-.195-.065-.26-.13-.52-.26-.715-.065-.065-.065-.195-.13-.26 0-.065-.065-.13-.065-.195-.065-.065-.065-.13-.13-.195s-.065-.13-.13-.195-.065-.13-.13-.195l-.195-.195-.13-.13-.195-.195-21.84-21.19c-.91-.91-2.145-1.365-3.38-1.365h-54.21c-1.3 0-2.535.52-3.445 1.43l-20.995 21.19-.065.065c-.065.065-.13.195-.26.26-.065.065-.065.13-.13.195s-.13.13-.13.195c-.065.065-.065.13-.13.195s-.065.13-.13.195-.065.13-.13.195-.065.13-.13.195c0 .065-.065.13-.065.195s-.065.13-.065.26c0 .065-.065.13-.065.195s-.065.13-.065.26c0 .065 0 .195-.065.26v39.78H25.892c-1.3 0-2.535.52-3.445 1.43l-21.06 21.19a4.79 4.79 0 0 0-1.365 3.835v64.805c0 2.665 2.21 4.875 4.875 4.875h291.2c2.665 0 4.875-2.21 4.875-4.875l.065-65.065v-.52c0-.065 0-.195-.065-.26m-28.6-15.535 11.83 11.44h-80.145v-11.44zm-147.29-65.26h50.18l11.83 11.44h-73.32zm-97.045 65.26h69.16v11.505l-81.185.65zm263.185 76.7H9.837v-54.73l92.235-.78c2.665 0 4.81-2.21 4.81-4.875v-60.385h87.295v60.385c0 2.665 2.21 4.875 4.875 4.875h92.17z"
        />
        <path fill={color} d="M145.689 172.649h9.75v32.63h-9.75z" />
      </svg>
    </div>
  );
}

// Loading screen — trophy fills from bottom to top

function LoadingState() {
  return (
    <>
      <style>{`
        @keyframes lb-fill {
          0%   { clip-path: inset(100% 0 0 0); opacity: 0.3; }
          40%  { opacity: 1; }
          100% { clip-path: inset(0% 0 0 0);   opacity: 1; }
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
        }}
      >
        {/* Trophy fills bottom-to-top via clip-path animation */}
        <div style={{ position: "relative", width: 64, height: 64 }}>
          {/* Ghost outline */}
          <TrophySvg color="rgba(240,160,80,0.12)" size={64} />
          {/* Filled layer animates upward */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              animation:
                "lb-fill 1.2s cubic-bezier(.4,0,.2,1) infinite alternate",
            }}
          >
            <TrophySvg color="#f0a050" size={64} />
          </div>
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

// WLD row

function WLD({
  e,
  compact = false,
}: {
  e: LeaderboardEntry;
  compact?: boolean;
}) {
  return (
    <div
      style={{ display: "flex", gap: compact ? 6 : 10, alignItems: "center" }}
    >
      {(
        [
          ["W", e.wins, "var(--coral)"],
          ["L", e.losses, "var(--amber)"],
          ["D", e.draws, "var(--muted)"],
        ] as [string, number, string][]
      ).map(([lbl, val, clr]) => (
        <span
          key={lbl}
          style={{ display: "flex", alignItems: "baseline", gap: 2 }}
        >
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: compact ? 7 : 8,
              fontWeight: 700,
              letterSpacing: 1.5,
              color: "var(--muted)",
            }}
          >
            {lbl}
          </span>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: compact ? 10 : 12,
              fontWeight: 900,
              color: clr,
            }}
          >
            {val}
          </span>
        </span>
      ))}
    </div>
  );
}

// My rank bar — pinned right below tabs, always visible

function MyRankBar({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 14px 9px 17px",
        background: "rgba(240,160,80,0.07)",
        borderBottom: "1px solid rgba(240,160,80,0.22)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: ME_COLOR,
        }}
      />

      {/* YOU pill */}
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 7,
          fontWeight: 900,
          letterSpacing: 2.5,
          color: ME_COLOR,
          opacity: 0.75,
          flexShrink: 0,
        }}
      >
        YOU
      </span>

      {/* Rank */}
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 20,
          fontWeight: 900,
          color: ME_COLOR,
          lineHeight: 1,
          letterSpacing: -1,
          flexShrink: 0,
        }}
      >
        #{entry.rank}
      </div>

      {/* Thin divider */}
      <div
        style={{
          width: 1,
          height: 26,
          background: "rgba(240,160,80,0.22)",
          flexShrink: 0,
        }}
      />

      {/* Name */}
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 11,
          fontWeight: 900,
          color: ME_COLOR,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {entry.username}
      </div>

      {/* WLD */}
      <WLD e={entry} compact />

      {/* Thin divider */}
      <div
        style={{
          width: 1,
          height: 26,
          background: "rgba(240,160,80,0.18)",
          flexShrink: 0,
        }}
      />

      {/* Rating — prominent */}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            fontWeight: 900,
            color: ME_COLOR,
            lineHeight: 1,
            letterSpacing: -0.5,
          }}
        >
          {entry.subscore}
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 7,
            fontWeight: 700,
            letterSpacing: 2,
            color: "var(--muted)",
            marginTop: 2,
          }}
        >
          RTG
        </div>
      </div>
    </div>
  );
}

// Podium card (top 5)

function PodiumCard({
  entry,
  isMe,
}: {
  entry: LeaderboardEntry;
  isMe: boolean;
}) {
  const cfg = RANK_CFG[Math.min(entry.rank - 1, 4)];
  const color = isMe ? ME_COLOR : cfg.color;
  const big = entry.rank === 1;

  return (
    <div
      style={{
        background: isMe ? "rgba(240,160,80,0.09)" : cfg.bg,
        border: `1px solid ${color}20`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 4,
        padding: big ? "14px 12px" : "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ghost rank numeral watermark */}
      <span
        style={{
          position: "absolute",
          top: -8,
          right: 6,
          fontFamily: "var(--font-display)",
          fontSize: big ? 70 : 54,
          fontWeight: 900,
          color,
          opacity: 0.1,
          lineHeight: 1,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {entry.rank}
      </span>

      {/* Row 1: icon + name/rating + wins */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Trophy or rank label */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: big ? 34 : 26,
            height: big ? 34 : 26,
          }}
        >
          {entry.rank <= 3 ? (
            <TrophySvg color={color} size={big ? 26 : 20} />
          ) : (
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 10,
                fontWeight: 900,
                color,
                opacity: 0.8,
              }}
            >
              #{entry.rank}
            </span>
          )}
        </div>

        {/* Name + rating */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: big ? 14 : 12,
              fontWeight: 900,
              color: isMe ? ME_COLOR : "var(--soft)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.15,
            }}
          >
            {entry.username}
            {isMe && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 7,
                  letterSpacing: 2,
                  color: ME_COLOR,
                  opacity: 0.8,
                }}
              >
                ▸ YOU
              </span>
            )}
          </div>
          {/* Rating is the visual anchor */}
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: big ? 26 : 20,
              fontWeight: 900,
              color,
              lineHeight: 1,
              marginTop: 1,
              letterSpacing: -0.5,
            }}
          >
            {entry.subscore}
            <span
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: 2,
                color: "var(--muted)",
                marginLeft: 4,
              }}
            >
              RTG
            </span>
          </div>
        </div>

        {/* Wins */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: big ? 28 : 22,
              fontWeight: 900,
              color,
              lineHeight: 1,
              letterSpacing: -1,
            }}
          >
            {entry.wins}
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 7,
              fontWeight: 700,
              letterSpacing: 2,
              color: "var(--muted)",
              marginTop: 1,
            }}
          >
            WINS
          </div>
        </div>
      </div>

      {/* Row 2: WLD + win rate */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <WLD e={entry} />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 1.5,
            color: "var(--muted)",
          }}
        >
          {winRate(entry)} WR
        </span>
      </div>
    </div>
  );
}

// Gap indicator (between top-5 and user if user is not in top 5)

function GapIndicator({ myRecord }: { myRecord: LeaderboardEntry }) {
  const gap = myRecord.rank - 5;
  return (
    <div
      style={{
        margin: "10px 14px 0",
        padding: "9px 12px",
        border: "1px dashed rgba(240,160,80,0.18)",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(240,160,80,0.025)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 10,
            color: "var(--muted)",
            letterSpacing: 3,
            opacity: 0.6,
          }}
        >
          • • •
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 9,
            fontWeight: 700,
            color: "var(--muted)",
            letterSpacing: 1,
          }}
        >
          {gap} player{gap !== 1 ? "s" : ""} between you and the top 5
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 10,
            fontWeight: 900,
            color: ME_COLOR,
            letterSpacing: -0.5,
          }}
        >
          #{myRecord.rank}
        </span>
        <div style={{ opacity: 0.6 }}>
          <TrophySvg color={ME_COLOR} size={11} />
        </div>
      </div>
    </div>
  );
}

// Empty state

function EmptyState({ tab, gamesPlayed }: { tab: Tab; gamesPlayed: number }) {
  const PLACEMENT_GAMES = 3;
  const gamesLeft = Math.max(0, PLACEMENT_GAMES - gamesPlayed);
  const isPlacement = gamesLeft > 0;

  return (
    <>
      <style>{`
        @keyframes es-fade {
          0%   { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        /* Podium trailing light */
        @keyframes podium-trail-move {
          0%   { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -320; }
        }
        @keyframes podium-trail-move2 {
          0%   { stroke-dashoffset: -80; }
          100% { stroke-dashoffset: -400; }
        }

        /* Placement card — game box glow */
        @keyframes es-box-glow {
          0%,100% { box-shadow: 0 0 0 0 rgba(240,160,80,0); }
          50%      { box-shadow: 0 0 8px 2px rgba(240,160,80,0.18); }
        }

        /* Placement card — shimmer sweep over filled boxes */
        @keyframes es-shimmer-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }

        /* Progress bar shimmer */
        @keyframes es-bar-shimmer {
          0%   { transform: translateX(-200%); }
          100% { transform: translateX(600%); }
        }

        /* Progress bar pulse */
        @keyframes es-progress-pulse {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.75; }
        }

        .es-box-filled {
          animation: es-box-glow 2.5s ease-in-out infinite;
        }
        .es-box-empty-1 {
          animation: es-box-glow 2.5s ease-in-out infinite 0.4s;
        }
        .es-box-empty-2 {
          animation: es-box-glow 2.5s ease-in-out infinite 0.8s;
        }
      `}</style>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 20,
          padding: "40px 24px",
          animation: "es-fade 0.4s ease both",
        }}
      >
        {/* Ghost podium — pulse opacity on wrapper */}
        <div
          style={{
            opacity: 0.15,
            animation: "es-progress-pulse 3s ease-in-out infinite",
          }}
        >
          <PodiumSvg color="var(--amber)" size={56} />
        </div>

        {/* Title */}
        <div
          style={{
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            {isPlacement ? "Placement Phase" : "No records yet"}
          </div>
          <div
            className="t-label"
            style={{ color: "var(--muted)", opacity: 0.55 }}
          >
            {isPlacement
              ? `Play ${gamesLeft} more game${gamesLeft !== 1 ? "s" : ""} to join the leaderboard`
              : tab === "xo_monthly"
                ? "Play a game to appear this month"
                : "No games recorded yet"}
          </div>
        </div>

        {/* Placement card */}
        {isPlacement && (
          <div
            style={{
              width: "100%",
              background: "rgba(240,160,80,0.05)",
              border: "1px solid rgba(240,160,80,0.18)",
              borderLeft: "3px solid rgba(240,160,80,0.45)",
              borderRadius: 4,
              padding: "14px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Progress boxes */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 2,
                    textTransform: "uppercase",
                    color: "var(--amber)",
                  }}
                >
                  ▸ Placement games
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 9,
                    fontWeight: 900,
                    color: "var(--amber)",
                  }}
                >
                  {gamesPlayed} / {PLACEMENT_GAMES}
                </span>
              </div>

              {/* Game boxes */}
              <div style={{ display: "flex", gap: 8 }}>
                {Array.from({ length: PLACEMENT_GAMES }).map((_, i) => {
                  const filled = i < gamesPlayed;
                  // Pick the right glow-delay class for empty boxes
                  const emptyClass =
                    i === 1 ? "es-box-empty-1" : "es-box-empty-2";

                  return (
                    <div
                      key={i}
                      className={filled ? "es-box-filled" : emptyClass}
                      style={{
                        flex: 1,
                        height: 36,
                        borderRadius: 3,
                        border: `1px solid ${filled ? "rgba(240,160,80,0.55)" : "rgba(240,160,80,0.12)"}`,
                        background: filled
                          ? "rgba(240,160,80,0.14)"
                          : "rgba(255,255,255,0.02)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexDirection: "column",
                        gap: 2,
                        transition: "all 0.2s ease",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {filled ? (
                        <>
                          <span
                            style={{
                              fontFamily: "var(--font-display)",
                              fontSize: 14,
                              fontWeight: 900,
                              color: "var(--amber)",
                              lineHeight: 1,
                              position: "relative",
                              zIndex: 1,
                            }}
                          >
                            ✓
                          </span>
                          {/* Shimmer sweep */}
                          <div
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "30%",
                              height: "100%",
                              background:
                                "linear-gradient(90deg, transparent, rgba(255,200,100,0.25), transparent)",
                              animation:
                                "es-shimmer-sweep 2.2s ease-in-out infinite",
                            }}
                          />
                        </>
                      ) : (
                        <span
                          style={{
                            fontFamily: "var(--font-display)",
                            fontSize: 14,
                            fontWeight: 900,
                            color: "rgba(240,160,80,0.2)",
                            lineHeight: 1,
                          }}
                        >
                          {i + 1}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Progress bar */}
              <div
                style={{
                  height: 3,
                  marginTop: 10,
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(gamesPlayed / PLACEMENT_GAMES) * 100}%`,
                    background: "var(--amber)",
                    borderRadius: 2,
                    transition: "width 0.4s ease",
                    position: "relative",
                    overflow: "hidden",
                    animation: "es-progress-pulse 2s ease-in-out infinite",
                  }}
                >
                  {/* Bar shimmer */}
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "50%",
                      height: "100%",
                      background:
                        "linear-gradient(90deg, transparent, rgba(255,230,150,0.7), transparent)",
                      animation: "es-bar-shimmer 1.8s ease-in-out infinite",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Rating deltas */}
            <div style={{ display: "flex", gap: 6 }}>
              {[
                {
                  label: "Win",
                  value: "+30",
                  color: "var(--coral)",
                  bg: "rgba(255,85,64,0.07)",
                  border: "rgba(255,85,64,0.18)",
                },
                {
                  label: "Loss",
                  value: "−15",
                  color: "var(--amber)",
                  bg: "rgba(240,160,80,0.07)",
                  border: "rgba(240,160,80,0.18)",
                },
                {
                  label: "Draw",
                  value: "±0",
                  color: "var(--muted)",
                  bg: "rgba(255,255,255,0.03)",
                  border: "var(--rim)",
                },
              ].map(({ label, value, color, bg, border }) => (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    padding: "7px 8px",
                    background: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 3,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 7,
                      fontWeight: 700,
                      letterSpacing: 1.5,
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
                      color,
                      lineHeight: 1,
                    }}
                  >
                    {value}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 7,
                      color: "var(--muted)",
                      letterSpacing: 1,
                    }}
                  >
                    rating pts
                  </span>
                </div>
              ))}
            </div>

            {/* Footer note */}
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 10,
                color: "var(--muted)",
                letterSpacing: 1,
                lineHeight: 1.7,
                opacity: 0.7,
              }}
            >
              Starting rating: 800. After {PLACEMENT_GAMES} games rating
              stabilises to +10 / −5 per game.
              {tab === "xo_monthly"
                ? " Monthly board resets on the 1st."
                : " All-time rank persists forever."}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

// Main screen

export default function LeaderboardScreen({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>("xo_monthly");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myRecord, setMyRecord] = useState<LeaderboardEntry | null>(null);
  const [myGamesPlayed, setMyGamesPlayed] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    setEntries([]);
    setMyRecord(null);

    const load = async () => {
      try {
        await new Promise((r) => setTimeout(r, 750));
        const { session } = await connect();
        if (!alive) return;

        const [rows, mine, profile] = await Promise.all([
          getLeaderboard(session, tab, 50),
          getMyLeaderboardRecord(session, tab),
          getProfile(session),
        ]);

        if (!alive) return;
        setEntries(rows);
        setMyRecord(mine);
        // Use profile for true games played
        setMyGamesPlayed(profile?.gamesPlayed ?? 0);
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, [tab]);

  const isMe = (e: LeaderboardEntry) =>
    !!myRecord && e.username === myRecord.username;

  const top5 = entries.slice(0, 5);
  const myInTop5 = myRecord ? myRecord.rank <= 5 : false;

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
      {/* BG glyphs */}
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
          RANKS<span className="topbar-logo-accent">.</span>
        </div>
        <span
          className="pill"
          style={{
            borderColor: "var(--amber)",
            color: "var(--amber)",
            fontSize: 9,
          }}
        >
          {loading ? "—" : `${entries.length} players`}
        </span>
      </header>

      {/* Placement banner */}
      {!loading &&
        !error &&
        (!myRecord || myRecord.rank === 0) &&
        entries.length > 0 && (
          <div
            style={{
              margin: "12px 14px 0",
              padding: "10px 14px",
              background: "rgba(240,160,80,0.05)",
              border: "1px solid rgba(240,160,80,0.18)",
              borderLeft: "3px solid rgba(240,160,80,0.5)",
              borderRadius: 4,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {/* Header row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: 2.5,
                  textTransform: "uppercase",
                  color: "var(--amber)",
                }}
              >
                ▸ Placement phase
              </span>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 8,
                  fontWeight: 900,
                  color: "var(--amber)",
                }}
              >
                {myGamesPlayed} / 3 games
              </span>
            </div>

            {/* Delta pills — compact single row */}
            <div style={{ display: "flex", gap: 6 }}>
              {[
                {
                  label: "Win",
                  value: "+30",
                  color: "var(--coral)",
                  bg: "rgba(255,85,64,0.07)",
                  border: "rgba(255,85,64,0.2)",
                },
                {
                  label: "Loss",
                  value: "−15",
                  color: "var(--amber)",
                  bg: "rgba(240,160,80,0.07)",
                  border: "rgba(240,160,80,0.2)",
                },
                {
                  label: "Draw",
                  value: "±0",
                  color: "var(--muted)",
                  bg: "rgba(255,255,255,0.03)",
                  border: "var(--rim)",
                },
              ].map(({ label, value, color, bg, border }) => (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    background: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 3,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 7,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      textTransform: "uppercase",
                      color: "var(--muted)",
                    }}
                  >
                    {label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 14,
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

            {/* Progress bar */}
            <div>
              <div
                style={{
                  height: 3,
                  width: `${(myGamesPlayed / 3) * 100}%`,
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: "0%",
                    background: "var(--amber)",
                    borderRadius: 2,
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 7,
                  color: "var(--muted)",
                  letterSpacing: 1,
                  marginTop: 4,
                  display: "block",
                }}
              >
                Play your first game to earn a rank. After 3 games rating
                stabilises to +10 / −5.
              </span>
            </div>
          </div>
        )}

      {/*  Tab strip  */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          borderBottom: "1px solid var(--rim)",
        }}
      >
        {(["xo_monthly", "xo_alltime"] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: "11px 0",
                background: "transparent",
                border: "none",
                borderBottom: active
                  ? "2px solid var(--amber)"
                  : "2px solid transparent",
                fontFamily: "var(--font-display)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2.5,
                textTransform: "uppercase",
                color: active ? "var(--amber)" : "var(--muted)",
                cursor: "pointer",
                transition: "color 100ms steps(2), border-color 100ms steps(2)",
              }}
            >
              {t === "xo_monthly" ? "This Month" : "All Time"}
            </button>
          );
        })}
      </div>

      {/*  MY RANK BAR — always visible just below tabs  */}
      {!loading && !error && myRecord && myRecord.rank > 0 && (
        <MyRankBar entry={myRecord} />
      )}

      {/*  Scrollable body  */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch" as const,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {loading && <LoadingState />}

        {error && !loading && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              gap: 12,
            }}
          >
            <div style={{ opacity: 0.2 }}>
              <TrophySvg color="var(--coral)" size={42} />
            </div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: "var(--coral)",
              }}
            >
              Failed to load
            </div>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <EmptyState tab={tab} gamesPlayed={myGamesPlayed} />
        )}

        {/*  Top 5 podium cards  */}
        {!loading && !error && top5.length > 0 && (
          <div
            style={{
              padding: "14px 14px 0",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginBottom: 2,
              }}
            >
              <div style={{ opacity: 0.5 }}>
                <TrophySvg color="var(--amber)" size={11} />
              </div>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  color: "var(--muted)",
                }}
              >
                Top Players
              </span>
            </div>
            {top5.map((entry) => (
              <PodiumCard key={entry.userId} entry={entry} isMe={isMe(entry)} />
            ))}
          </div>
        )}

        {/*  Gap indicator when user is outside top 5  */}
        {!loading && !error && !myInTop5 && myRecord && myRecord.rank > 0 && (
          <GapIndicator myRecord={myRecord} />
        )}

        <div style={{ height: 24 }} />
      </div>

      {/*  Season note  */}
      {tab === "xo_monthly" && !loading && (
        <footer
          style={{
            flexShrink: 0,
            padding: "7px 14px",
            borderTop: "1px solid var(--rim)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "var(--muted)",
              textAlign: "center",
            }}
          >
            Resets on the 1st of each month
          </div>
        </footer>
      )}
    </div>
  );
}
